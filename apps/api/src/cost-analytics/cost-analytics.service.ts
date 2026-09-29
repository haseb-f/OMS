import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  businessDateOf,
  businessDateRangeFilter,
} from '../common/time/business-date';
import { round2 } from '../sales/shared/sales-totals.util';
import { OrderEconomicsService } from '../store-orders/order-economics/order-economics.service';
import type {
  CostState,
  OrderEconomics,
} from '../store-orders/order-economics/order-economics.types';
import { AccountingReportsService } from '../accounting/reports/accounting-reports.service';
import { PostingSettingsService } from '../accounting/posting-settings/posting-settings.service';
import { CostAnalyticsScopeDto } from './dto/cost-analytics-scope.dto';
import {
  ProfitabilityQueryDto,
  type ProfitabilityDimension,
} from './dto/profitability-query.dto';

/** Bounds one Management P&L / Profitability Analytics request's Order scope — same "select all matching filters, capped" discipline `SELECT_ALL_MATCHING_CAP` already uses elsewhere. A request that hits the cap is told so (`truncated: true`), never silently under-reported. */
const SCOPED_ORDER_CAP = 20_000;

/** Worst-case rollup of a set of per-order `CostState` values, same rule `OrderEconomicsService.computeEconomics` uses for a single Order's overall `costState`. */
function worstState(states: CostState[]): CostState {
  if (states.length === 0) return 'UNKNOWN';
  if (states.every((s) => s === 'COMPLETE')) return 'COMPLETE';
  if (states.every((s) => s === 'UNKNOWN')) return 'UNKNOWN';
  return 'PARTIAL';
}

export interface DimensionRow {
  dimensionValue: string;
  dimensionLabel: string;
  orderCount: number;
  /** Sum of item quantities in scope — the BY_QUANTITY allocation basis (M4). */
  totalQuantity: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  /** Null for the PRODUCT dimension — direct costs (shipping/payment fees/fulfillment) are captured at Order level only, never allocated down to a line item, so a per-product Contribution Profit would be fabricated. Use the ORDER or Cost Allocation (M4) views for a Contribution/Operating figure at Product grain. */
  totalDirectCost: number | null;
  contributionProfit: number | null;
  contributionMarginPercent: number | null;
  costState: CostState;
}

type StoreOrderDimensionRow = Prisma.StoreOrderGetPayload<{
  select: {
    id: true;
    orderDate: true;
    sourceChannel: true;
    source: true;
    internalOrderId: true;
    employeeId: true;
    employee: { select: { fullName: true } };
    partnerId: true;
    partner: {
      select: {
        name: true;
        countryId: true;
        country: { select: { name: true } };
      };
    };
  };
}>;

/**
 * M3 (Cost Module completion) — Management P&L and multi-dimensional
 * Profitability Analytics. A read-only aggregation layer, never a second
 * calculation of Order-level economics: `OrderEconomicsService` stays the
 * one place COGS/shipping/payment-fee/fulfillment/Contribution Profit are
 * computed (`getSummaryForOrders`, the same batched call the Orders list
 * and Cost Explorer already use). Operating Expenses and Net Profit are
 * read live from `AccountingReportsService`'s own canonical GL query — GL
 * remains the sole source of company financial statements.
 *
 * Contribution Profit (order-side, `OrderEconomicsService`), Operating
 * Profit (= aggregated Contribution Profit − GL Operating Expenses) and Net
 * Profit (= GL's own `incomeStatement().totals.netIncome`, a straight
 * pass-through) are three distinct figures returned separately — never
 * merged into one number.
 *
 * Counted once (owner decision P2, round 3): Contribution Profit already
 * deducts COGS, carrier shipping, gateway commissions and fulfilment at
 * order level, so the GL accounts on those Income Statement lines (cost of
 * sales and the Shipping / Payment gateway / Fulfillment selling lines) are
 * NOT subtracted again — "Operating Expenses" are only the Income
 * Statement's other selling + general & administrative lines. The result is
 * bridged to the Income Statement's operating profit for the same
 * Africa/Cairo business-day period (`incomeStatementReconciliation`): the
 * difference is order-level vs GL on each attributed line (orders by order
 * date vs postings by posting date, company orders only, estimated vs
 * posted costs) plus contribution the orders could not compute.
 */
@Injectable()
export class CostAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderEconomicsService: OrderEconomicsService,
    private readonly accountingReportsService: AccountingReportsService,
    private readonly postingSettingsService: PostingSettingsService,
  ) {}

  private buildOrderWhere(
    scope: CostAnalyticsScopeDto,
  ): Prisma.StoreOrderWhereInput {
    return {
      deletedAt: null,
      // F-M3: company management reporting covers company orders only —
      // agent merchandise is never company revenue (the company's agent
      // income is posted to the GL as commission / fulfillment revenue).
      agentId: null,
      ...(scope.dateFrom || scope.dateTo
        ? { orderDate: businessDateRangeFilter(scope.dateFrom, scope.dateTo) }
        : {}),
      ...(scope.partnerId && { partnerId: scope.partnerId }),
      ...(scope.employeeId && { employeeId: scope.employeeId }),
      ...(scope.sourceChannel && { sourceChannel: scope.sourceChannel }),
      ...(scope.countryId && { partner: { countryId: scope.countryId } }),
    };
  }

  private async resolveScopedOrderIds(
    scope: CostAnalyticsScopeDto,
  ): Promise<{ ids: string[]; total: number; truncated: boolean }> {
    const where = this.buildOrderWhere(scope);
    const [rows, total] = await Promise.all([
      this.prisma.storeOrder.findMany({
        where,
        select: { id: true },
        take: SCOPED_ORDER_CAP,
        orderBy: { orderDate: 'desc' },
      }),
      this.prisma.storeOrder.count({ where }),
    ]);
    return {
      ids: rows.map((r) => r.id),
      total,
      truncated: total > rows.length,
    };
  }

  private async loadDimensionMetadata(
    ids: string[],
  ): Promise<Map<string, StoreOrderDimensionRow>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.storeOrder.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        orderDate: true,
        sourceChannel: true,
        source: true,
        internalOrderId: true,
        employeeId: true,
        employee: { select: { fullName: true } },
        partnerId: true,
        partner: {
          select: {
            name: true,
            countryId: true,
            country: { select: { name: true } },
          },
        },
      },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** Sums only the KNOWN economics across a scope — never fabricates an UNKNOWN order's contribution as 0 (it's simply excluded from the sum, same discipline `OrderEconomicsService` itself uses per component). */
  private aggregateContribution(rows: OrderEconomics[]) {
    let netRevenue = 0;
    let cogs = 0;
    let grossProductProfit = 0;
    let shippingCost = 0;
    let paymentFeeCost = 0;
    let fulfillmentCost = 0;
    let totalDirectCost = 0;
    let contributionProfit = 0;
    let totalQuantity = 0;
    const costStates: CostState[] = [];
    for (const r of rows) {
      netRevenue += r.netRevenue;
      cogs += r.cogs;
      grossProductProfit += r.grossProductProfit;
      shippingCost += r.shippingCost;
      paymentFeeCost += r.paymentFeeCost;
      fulfillmentCost += r.fulfillmentCost;
      totalDirectCost += r.totalDirectCost;
      contributionProfit += r.contributionProfit;
      for (const item of r.items) totalQuantity += item.quantity;
      costStates.push(r.costState);
    }
    return {
      netRevenue: round2(netRevenue),
      cogs: round2(cogs),
      grossProductProfit: round2(grossProductProfit),
      shippingCost: round2(shippingCost),
      paymentFeeCost: round2(paymentFeeCost),
      fulfillmentCost: round2(fulfillmentCost),
      totalDirectCost: round2(totalDirectCost),
      contributionProfit: round2(contributionProfit),
      totalQuantity,
      coverage: {
        orderCount: rows.length,
        complete: costStates.filter((s) => s === 'COMPLETE').length,
        partial: costStates.filter((s) => s === 'PARTIAL').length,
        unknown: costStates.filter((s) => s === 'UNKNOWN').length,
      },
      costState: worstState(costStates),
    };
  }

  async getManagementPnl(scope: CostAnalyticsScopeDto) {
    const { ids, total, truncated } = await this.resolveScopedOrderIds(scope);
    const economicsMap =
      await this.orderEconomicsService.getSummaryForOrders(ids);
    const contribution = this.aggregateContribution([...economicsMap.values()]);

    const [incomeStatement, postingSettings] = await Promise.all([
      this.accountingReportsService.incomeStatement({
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo,
        costCenterId: scope.costCenterId,
        postedOnly: true,
      }),
      this.postingSettingsService.get(),
    ]);

    // Each cost is counted exactly once. Cost of sales, carrier shipping,
    // gateway commissions and fulfilment are ATTRIBUTED at order level (in
    // Contribution Profit above), so their GL accounts are not subtracted
    // again; only the operating expenses the orders do not carry (other
    // selling + general & administrative — the Income Statement's own lines)
    // are. Other income / expenses, finance costs and FX sit below operating
    // profit, as in the Income Statement.
    const cogsAccountId = postingSettings.costOfGoodsSoldAccountId;
    const accountLines = incomeStatement.accountLines ?? {};
    const isUnattributedOperating = (accountId: string) => {
      const entry = accountLines[accountId];
      if (!entry) return false;
      return (
        entry.line === 'ADMINISTRATIVE' ||
        (entry.line === 'SELLING_DISTRIBUTION' &&
          entry.sellingLine === 'OTHER_SELLING')
      );
    };
    const operatingExpenseRows = [
      ...incomeStatement.expense,
      // A revenue-type account on an expense line (e.g. purchase discounts)
      // reduces that line: shown as a negative expense.
      ...incomeStatement.revenue.map((row) => ({
        ...row,
        balance: round2(-row.balance),
      })),
    ].filter(
      (row) =>
        row.accountId !== cogsAccountId &&
        isUnattributedOperating(row.accountId),
    );
    const operatingExpenses = round2(
      operatingExpenseRows.reduce((sum, row) => sum + row.balance, 0),
    );
    const operatingProfit = round2(
      contribution.contributionProfit - operatingExpenses,
    );

    // Bridge to the Income Statement's operating profit for the same
    // business-day period: management OP − IS OP = (order-level − GL) on the
    // attributed lines, plus contribution the orders could not compute.
    const is = incomeStatement.totals;
    const gl = {
      netRevenue: is.netRevenue ?? 0,
      costOfSales: is.costOfSales ?? 0,
      shipping: is.shippingDelivery ?? 0,
      paymentFees: is.paymentGatewayFees ?? 0,
      fulfillment: is.fulfillment ?? 0,
    };
    const bridgeItem = (
      key: string,
      orderLevel: number,
      glAmount: number,
      nature: 'income' | 'cost',
    ) => ({
      key,
      orderLevel: round2(orderLevel),
      gl: round2(glAmount),
      /** Effect on management operating profit vs the Income Statement. */
      effect: round2(
        nature === 'income' ? orderLevel - glAmount : glAmount - orderLevel,
      ),
    });
    const computedContribution = round2(
      contribution.netRevenue -
        contribution.cogs -
        contribution.shippingCost -
        contribution.paymentFeeCost -
        contribution.fulfillmentCost,
    );
    const bridge = [
      bridgeItem(
        'NET_REVENUE',
        contribution.netRevenue,
        gl.netRevenue,
        'income',
      ),
      bridgeItem('COST_OF_SALES', contribution.cogs, gl.costOfSales, 'cost'),
      bridgeItem('SHIPPING', contribution.shippingCost, gl.shipping, 'cost'),
      bridgeItem(
        'PAYMENT_FEES',
        contribution.paymentFeeCost,
        gl.paymentFees,
        'cost',
      ),
      bridgeItem(
        'FULFILLMENT',
        contribution.fulfillmentCost,
        gl.fulfillment,
        'cost',
      ),
      {
        key: 'CONTRIBUTION_NOT_COMPUTED',
        orderLevel: contribution.contributionProfit,
        gl: computedContribution,
        effect: round2(contribution.contributionProfit - computedContribution),
      },
    ];
    const incomeStatementOperatingProfit = round2(is.operatingProfit ?? 0);
    const difference = round2(operatingProfit - incomeStatementOperatingProfit);
    const bridgeTotal = round2(bridge.reduce((sum, b) => sum + b.effect, 0));

    return {
      scope: {
        dateFrom: scope.dateFrom ?? null,
        dateTo: scope.dateTo ?? null,
        scopedOrderCount: total,
        truncated,
      },
      revenue: contribution.netRevenue,
      cogs: contribution.cogs,
      grossProfit: contribution.grossProductProfit,
      directCosts: {
        shipping: contribution.shippingCost,
        paymentFees: contribution.paymentFeeCost,
        fulfillment: contribution.fulfillmentCost,
        total: contribution.totalDirectCost,
      },
      contributionProfit: contribution.contributionProfit,
      contributionMarginPercent:
        contribution.netRevenue > 0
          ? round2(
              (contribution.contributionProfit / contribution.netRevenue) * 100,
            )
          : null,
      coverage: contribution.coverage,
      costState: contribution.costState,
      operatingExpenses: {
        total: operatingExpenses,
        accounts: operatingExpenseRows,
        /** GL operating expenses the orders do not carry (other selling + G&A). */
        basis: 'NOT_ATTRIBUTED_AT_ORDER_LEVEL' as const,
      },
      /** The GL side of the costs attributed at order level — not subtracted again. */
      attributedCostsInGl: {
        costOfSales: round2(gl.costOfSales),
        shipping: round2(gl.shipping),
        paymentFees: round2(gl.paymentFees),
        fulfillment: round2(gl.fulfillment),
      },
      operatingProfit,
      incomeStatementReconciliation: {
        managementOperatingProfit: operatingProfit,
        incomeStatementOperatingProfit,
        difference,
        bridge,
        /** Σ bridge effects = difference (always, by construction). */
        balanced: Math.abs(bridgeTotal - difference) < 0.01,
      },
      glReconciliation: {
        revenueFromGl: round2(
          incomeStatement.revenue.reduce((sum, row) => sum + row.balance, 0),
        ),
        expenseFromGl: incomeStatement.totals.totalExpense,
        netProfitFromGl: incomeStatement.totals.netIncome,
      },
    };
  }

  private resolveDimensionKey(
    dimension: ProfitabilityDimension,
    meta: StoreOrderDimensionRow | undefined,
    granularity: 'day' | 'week' | 'month',
  ): { value: string; label: string } {
    if (!meta) return { value: 'UNASSIGNED', label: 'Unassigned' };
    switch (dimension) {
      case 'ORDER':
        return { value: meta.id, label: meta.internalOrderId };
      case 'CUSTOMER':
        return { value: meta.partnerId, label: meta.partner.name };
      case 'EMPLOYEE':
        return meta.employeeId
          ? {
              value: meta.employeeId,
              label: meta.employee?.fullName ?? meta.employeeId,
            }
          : { value: 'UNASSIGNED', label: 'Unassigned' };
      case 'CHANNEL':
        return meta.sourceChannel
          ? { value: meta.sourceChannel, label: meta.sourceChannel }
          : { value: meta.source, label: meta.source };
      case 'COUNTRY':
        return meta.partner.countryId
          ? {
              value: meta.partner.countryId,
              label: meta.partner.country?.name ?? 'Unknown',
            }
          : { value: 'UNASSIGNED', label: 'Unknown' };
      case 'PERIOD': {
        // Buckets are Africa/Cairo business days (the same day the date
        // filter and every financial report use), never server-local / UTC.
        const day = businessDateOf(new Date(meta.orderDate));
        if (granularity === 'day') return { value: day, label: day };
        const year = Number(day.slice(0, 4));
        if (granularity === 'week') {
          const date = Date.UTC(
            year,
            Number(day.slice(5, 7)) - 1,
            Number(day.slice(8, 10)),
          );
          const onejan = new Date(Date.UTC(year, 0, 1));
          const week = Math.ceil(
            ((date - onejan.getTime()) / 86400000 + onejan.getUTCDay() + 1) / 7,
          );
          const value = `${year}-W${String(week).padStart(2, '0')}`;
          return { value, label: value };
        }
        const value = day.slice(0, 7);
        return { value, label: value };
      }
      default:
        return { value: 'UNASSIGNED', label: 'Unassigned' };
    }
  }

  /**
   * Every non-PRODUCT dimension groups whole-Order economics (Revenue,
   * COGS, Direct Costs, Contribution Profit all apply cleanly at Order
   * grain). PRODUCT groups `OrderEconomics.items[]` instead — Revenue/COGS/
   * Gross Profit only, `totalDirectCost`/`contributionProfit` stay `null`
   * rather than fabricate a per-line-item share of Order-level shipping/
   * payment-fee/fulfillment cost (see `DimensionRow`'s own comment).
   */
  async getProfitabilityAnalytics(query: ProfitabilityQueryDto) {
    const {
      ids,
      total: scopedOrderTotal,
      truncated,
    } = await this.resolveScopedOrderIds(query);
    const economicsMap =
      await this.orderEconomicsService.getSummaryForOrders(ids);
    const granularity = query.periodGranularity ?? 'month';

    let rows: DimensionRow[];

    if (query.dimension === 'PRODUCT') {
      const productIds = new Set<string>();
      for (const economics of economicsMap.values()) {
        for (const item of economics.items) productIds.add(item.productId);
      }
      const products = await this.prisma.product.findMany({
        where: { id: { in: [...productIds] } },
        select: { id: true, name: true },
      });
      const productNames = new Map(products.map((p) => [p.id, p.name]));

      const byProduct = new Map<
        string,
        {
          revenue: number;
          cogs: number;
          quantity: number;
          orderIds: Set<string>;
          cogsStates: CostState[];
        }
      >();
      for (const economics of economicsMap.values()) {
        for (const item of economics.items) {
          const bucket = byProduct.get(item.productId) ?? {
            revenue: 0,
            cogs: 0,
            quantity: 0,
            orderIds: new Set<string>(),
            cogsStates: [],
          };
          bucket.revenue += item.netRevenue;
          bucket.cogs += item.cogs ?? 0;
          bucket.quantity += item.quantity;
          bucket.orderIds.add(economics.storeOrderId);
          bucket.cogsStates.push(item.cogs !== null ? 'COMPLETE' : 'UNKNOWN');
          byProduct.set(item.productId, bucket);
        }
      }
      rows = [...byProduct.entries()].map(([productId, bucket]) => ({
        dimensionValue: productId,
        dimensionLabel: productNames.get(productId) ?? productId,
        orderCount: bucket.orderIds.size,
        totalQuantity: bucket.quantity,
        netRevenue: round2(bucket.revenue),
        cogs: round2(bucket.cogs),
        grossProfit: round2(bucket.revenue - bucket.cogs),
        totalDirectCost: null,
        contributionProfit: null,
        contributionMarginPercent: null,
        costState: worstState(bucket.cogsStates),
      }));
      rows.sort((a, b) => b.netRevenue - a.netRevenue);
    } else {
      const metaMap = await this.loadDimensionMetadata(ids);
      const byDimension = new Map<
        string,
        { label: string; orders: OrderEconomics[] }
      >();
      for (const economics of economicsMap.values()) {
        const meta = metaMap.get(economics.storeOrderId);
        const { value, label } = this.resolveDimensionKey(
          query.dimension,
          meta,
          granularity,
        );
        const bucket = byDimension.get(value) ?? { label, orders: [] };
        bucket.orders.push(economics);
        byDimension.set(value, bucket);
      }
      rows = [...byDimension.entries()].map(([value, bucket]) => {
        const agg = this.aggregateContribution(bucket.orders);
        return {
          dimensionValue: value,
          dimensionLabel: bucket.label,
          orderCount: bucket.orders.length,
          totalQuantity: agg.totalQuantity,
          netRevenue: agg.netRevenue,
          cogs: agg.cogs,
          grossProfit: agg.grossProductProfit,
          totalDirectCost: agg.totalDirectCost,
          contributionProfit: agg.contributionProfit,
          contributionMarginPercent:
            agg.netRevenue > 0
              ? round2((agg.contributionProfit / agg.netRevenue) * 100)
              : null,
          costState: agg.costState,
        };
      });
      rows.sort(
        (a, b) => (b.contributionProfit ?? 0) - (a.contributionProfit ?? 0),
      );
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const start = (page - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);

    return {
      dimension: query.dimension,
      scope: { scopedOrderCount: scopedOrderTotal, truncated },
      total: rows.length,
      page,
      pageSize,
      rows: pageRows,
    };
  }
}
