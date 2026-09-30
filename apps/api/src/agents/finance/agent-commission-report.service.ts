import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { storeOrderLineAmount } from '../../store-orders/store-order-line-amount';
import { netConfirmedCarrierCost } from '../../carrier-reconciliation/carrier-charge-net';
import { agentNotFoundError } from '../common/agent-errors';
import { AgentStatementService, periodBounds } from './agent-statement.service';
import { fromMinor, round2, toMinor } from './agent-ledger.math';
import type { AgentOrderSnapshot } from '../common/agent-terms';

const sum = (values: number[]) =>
  fromMinor(values.reduce((acc, value) => acc + toMinor(value), 0));

/**
 * Contractual agent shipping fee − carrier cost (spec 2B, internal only):
 * the approved net in the agent's currency, else the operational estimate
 * when nothing was approved yet; null when not comparable.
 */
function shippingMargin(
  fee: number | null,
  carrier: {
    estimated: number;
    approvedByCurrency: Array<{ currencyCode: string; amount: number }>;
  },
  currencyCode: string,
) {
  if (fee == null) return null;
  const approved = carrier.approvedByCurrency;
  if (approved.length === 1 && approved[0].currencyCode === currencyCode) {
    return { amount: round2(fee - approved[0].amount), basis: 'ACTUAL' };
  }
  if (approved.length === 0 && carrier.estimated > 0) {
    return { amount: round2(fee - carrier.estimated), basis: 'ESTIMATE' };
  }
  return null;
}

/** Order-linked charges other than commission and retained customer shipping. */
const OTHER_CHARGE_TYPES = [
  'SHIPPING_FEE',
  'RETURN_FEE',
  'SERVICE_FEE',
  'PROVIDER_FEE',
  'ADJUSTMENT',
] as const;

export interface CommissionReportQuery {
  from?: string;
  to?: string;
}

/**
 * Who reads the report. INTERNAL (Finance, agent managers) sees the actual
 * carrier cost and the company shipping margin; PORTAL (agent users) never
 * does — spec-2-agent-pricing.md 2E removes them from the serializer, not
 * just from the screen.
 */
export type CommissionReportAudience = 'INTERNAL' | 'PORTAL';

/**
 * Agent commission report (commission-policy.md A7). Earned view per order
 * line — sales, base, rate, commission, reversals — and per order the four
 * shipping amounts kept apart: customer shipping collected (company money),
 * the predetermined agent shipping charge, the retained amount that settles
 * it, and the actual carrier cost (company expense, informational — never an
 * agent deduction). Net entitlement is the earned view; the cash view
 * (collected, available, paid out) comes from the ledger balances.
 *
 * Scope: the agent's orders dispatched or earned in the period (all when
 * no period). Reversals are shown to date.
 */
@Injectable()
export class AgentCommissionReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statements: AgentStatementService,
  ) {}

  async report(
    agentId: string,
    query: CommissionReportQuery,
    audience: CommissionReportAudience = 'INTERNAL',
  ) {
    const internal = audience === 'INTERNAL';
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, deletedAt: null },
      select: {
        id: true,
        agentNumber: true,
        name: true,
        currencyId: true,
        currency: { select: { id: true, code: true, symbol: true } },
      },
    });
    if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
    const { start, end } = periodBounds(query.from, query.to);
    const range =
      start || end
        ? { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) }
        : undefined;
    const orderWhere: Prisma.StoreOrderWhereInput = {
      agentId,
      deletedAt: null,
      ...(range
        ? {
            OR: [{ agentEarnedAt: range }, { agentDispatchedAt: range }],
          }
        : {
            OR: [
              { agentEarnedAt: { not: null } },
              { agentDispatchedAt: { not: null } },
            ],
          }),
    };
    const orders = await this.prisma.storeOrder.findMany({
      where: orderWhere,
      orderBy: [{ agentEarnedAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        internalOrderId: true,
        currencyId: true,
        agentEarnedAt: true,
        agentDispatchedAt: true,
        merchandiseAmount: true,
        shippingCharge: true,
        serviceCharge: true,
        taxAmount: true,
        agentTermsSnapshot: true,
        items: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            productId: true,
            quantity: true,
            unitPrice: true,
            agreedAmount: true,
            product: { select: { sku: true, name: true, nameEn: true } },
          },
        },
        // Carrier cost is read for the internal audience only.
        shipments: {
          where: internal ? { deletedAt: null } : { id: { in: [] } },
          select: {
            id: true,
            attemptNumber: true,
            baseShippingCost: true,
            additionalShippingCost: true,
            carrierCharges: {
              where: { deletedAt: null },
              select: {
                chargeAmount: true,
                chargeKind: true,
                reconciliationState: true,
                paidAt: true,
                currency: { select: { code: true } },
              },
            },
          },
        },
        agentReturns: { select: { merchandiseAmount: true } },
      },
    });
    const orderIds = orders.map((o) => o.id);
    const [commissionLines, ledgerRows, balances] = await Promise.all([
      this.prisma.agentCommissionLine.findMany({
        where: { storeOrderId: { in: orderIds } },
        select: {
          storeOrderId: true,
          storeOrderItemId: true,
          productId: true,
          commissionClass: true,
          rateSource: true,
          ratePercent: true,
          salesAmount: true,
          returnedBeforeEarning: true,
          baseAmount: true,
          amount: true,
          ledgerEntry: { select: { entryType: true } },
        },
      }),
      this.prisma.agentLedgerEntry.findMany({
        where: { agentId, storeOrderId: { in: orderIds } },
        select: {
          id: true,
          storeOrderId: true,
          entryType: true,
          currencyId: true,
          debit: true,
          credit: true,
          memoAmount: true,
        },
      }),
      this.statements.balances(agentId),
    ]);

    const lineRows: Array<Record<string, unknown>> = [];
    const orderRows = orders.map((order) => {
      const own = ledgerRows.filter((row) => row.storeOrderId === order.id);
      const signed = (type: string) =>
        sum(
          own
            .filter((row) => row.entryType === type)
            .map((row) => Number(row.debit) - Number(row.credit)),
        );
      const commissionEntry = own.find((row) => row.entryType === 'COMMISSION');
      const lines = commissionLines.filter((l) => l.storeOrderId === order.id);
      const earned = lines.filter(
        (l) => l.ledgerEntry.entryType === 'COMMISSION',
      );
      const reversedByItem = new Map<string, number>();
      for (const l of lines) {
        if (l.ledgerEntry.entryType !== 'COMMISSION_REVERSAL') continue;
        const key = l.storeOrderItemId ?? '';
        reversedByItem.set(
          key,
          round2((reversedByItem.get(key) ?? 0) + Number(l.amount)),
        );
      }
      if (earned.length > 0) {
        for (const l of earned) {
          const item = order.items.find((i) => i.id === l.storeOrderItemId);
          lineRows.push({
            storeOrderId: order.id,
            orderNumber: order.internalOrderId,
            productId: l.productId,
            sku: item?.product.sku ?? null,
            name: item?.product.name ?? null,
            nameEn: item?.product.nameEn ?? null,
            commissionClass: l.commissionClass,
            rateSource: l.rateSource,
            ratePercent: Number(l.ratePercent),
            salesAmount: Number(l.salesAmount),
            returnedBeforeEarning: Number(l.returnedBeforeEarning),
            commissionBase: Number(l.baseAmount),
            commission: Number(l.amount),
            commissionReversed:
              reversedByItem.get(l.storeOrderItemId ?? '') ?? 0,
          });
        }
      } else if (commissionEntry) {
        // Earned before per-line detail existed: one legacy row per order.
        lineRows.push({
          storeOrderId: order.id,
          orderNumber: order.internalOrderId,
          productId: null,
          sku: null,
          name: null,
          nameEn: null,
          commissionClass: null,
          rateSource: 'LEGACY_SINGLE_RATE',
          ratePercent: null,
          salesAmount: sum(order.items.map((i) => storeOrderLineAmount(i))),
          returnedBeforeEarning: 0,
          commissionBase: null,
          commission: Number(commissionEntry.debit),
          commissionReversed: -signed('COMMISSION_REVERSAL'),
        });
      }

      // Actual carrier cost: company expense (carrier currency), internal only.
      const carrier = internal ? this.carrierCostStages(order.shipments) : null;
      const snapshot = order.agentTermsSnapshot as AgentOrderSnapshot | null;
      const agentShippingCharge =
        snapshot?.agentShippingCharge?.amount != null
          ? round2(snapshot.agentShippingCharge.amount)
          : null;
      const customerShipping = round2(Number(order.shippingCharge ?? 0));
      const shippingRetained = round2(
        signed('CUSTOMER_SHIPPING_RETAINED') +
          signed('CUSTOMER_SHIPPING_RETAINED_REVERSAL'),
      );
      const otherCharges = sum(OTHER_CHARGE_TYPES.map((type) => signed(type)));
      const sales = order.agentEarnedAt
        ? sum(order.items.map((i) => storeOrderLineAmount(i)))
        : 0;
      const returned = order.agentEarnedAt
        ? sum(order.agentReturns.map((r) => Number(r.merchandiseAmount)))
        : 0;
      // What the customer paid on top of the merchandise (shipping charge,
      // service charge, tax) is collected into the agent's balance too; a
      // charge the company retains comes back out through otherCharges.
      const customerCharges = order.agentEarnedAt
        ? sum([
            Number(order.shippingCharge ?? 0),
            Number(order.serviceCharge ?? 0),
            Number(order.taxAmount ?? 0),
          ])
        : 0;
      const commissionNet = round2(
        signed('COMMISSION') + signed('COMMISSION_REVERSAL'),
      );
      return {
        storeOrderId: order.id,
        orderNumber: order.internalOrderId,
        earnedAt: order.agentEarnedAt,
        dispatchedAt: order.agentDispatchedAt,
        sales,
        customerCharges,
        returned,
        commissionNet,
        shipping: {
          customerShipping,
          agentShippingCharge,
          retained: shippingRetained,
          /** customer − predetermined (non-zero orders were refused at submission). */
          difference:
            agentShippingCharge == null
              ? null
              : round2(customerShipping - agentShippingCharge),
          ...(carrier
            ? {
                carrier,
                /** Company shipping margin = contractual fee − carrier cost (internal). */
                margin: shippingMargin(
                  agentShippingCharge,
                  carrier,
                  agent.currency.code,
                ),
              }
            : {}),
        },
        otherCharges,
        netEntitlement: round2(
          sales +
            customerCharges -
            returned -
            commissionNet -
            shippingRetained -
            otherCharges,
        ),
      };
    });

    const byClass = (cls: 'PRODUCT' | 'SERVICE') => {
      const rows = lineRows.filter((r) => r.commissionClass === cls);
      return {
        sales: sum(rows.map((r) => Number(r.salesAmount))),
        commissionBase: sum(rows.map((r) => Number(r.commissionBase ?? 0))),
        commission: sum(rows.map((r) => Number(r.commission))),
        commissionReversed: sum(rows.map((r) => Number(r.commissionReversed))),
      };
    };
    const legacyRows = lineRows.filter((r) => r.commissionClass == null);
    const cash = this.cashView(ledgerRows, balances.balances, agent.currencyId);
    const summary = {
      currency: agent.currency,
      products: byClass('PRODUCT'),
      services: byClass('SERVICE'),
      legacySingleRate: {
        sales: sum(legacyRows.map((r) => Number(r.salesAmount))),
        commission: sum(legacyRows.map((r) => Number(r.commission))),
        commissionReversed: sum(
          legacyRows.map((r) => Number(r.commissionReversed)),
        ),
      },
      totalSales: sum(orderRows.map((o) => o.sales)),
      customerCharges: sum(orderRows.map((o) => o.customerCharges)),
      returned: sum(orderRows.map((o) => o.returned)),
      totalCommission: sum(orderRows.map((o) => o.commissionNet)),
      customerShipping: sum(orderRows.map((o) => o.shipping.customerShipping)),
      agentShippingCharges: sum(
        orderRows.map((o) => o.shipping.agentShippingCharge ?? 0),
      ),
      shippingRetained: sum(orderRows.map((o) => o.shipping.retained)),
      otherCharges: sum(orderRows.map((o) => o.otherCharges)),
      netEntitlement: sum(orderRows.map((o) => o.netEntitlement)),
      ...(internal
        ? {
            carrierCost: {
              ordersWithEstimateOnly: orderRows.filter(
                (o) =>
                  (o.shipping.carrier?.estimated ?? 0) > 0 &&
                  o.shipping.carrier?.approvedByCurrency.length === 0,
              ).length,
              ordersAwaitingApproval: orderRows.filter(
                (o) => (o.shipping.carrier?.incurredByCurrency.length ?? 0) > 0,
              ).length,
            },
          }
        : {}),
    };
    return {
      agent: {
        id: agent.id,
        agentNumber: agent.agentNumber,
        name: agent.name,
      },
      period: { from: query.from ?? null, to: query.to ?? null },
      summary,
      cash,
      orders: orderRows,
      lines: lineRows,
    };
  }

  /**
   * Estimated (operational cost of shipments with nothing approved),
   * incurred (matched, awaiting approval), approved (net confirmed) and paid
   * — per carrier currency, never summed across currencies.
   */
  private carrierCostStages(
    shipments: Array<{
      baseShippingCost: Prisma.Decimal | null;
      additionalShippingCost: Prisma.Decimal | null;
      carrierCharges: Array<{
        chargeAmount: Prisma.Decimal;
        chargeKind: 'BASE' | 'SURCHARGE' | 'CREDIT';
        reconciliationState: string;
        paidAt: Date | null;
        currency: { code: string };
      }>;
    }>,
  ) {
    let estimated = 0;
    const incurred = new Map<string, number>();
    const approved = new Map<string, number>();
    const paid = new Map<string, number>();
    const add = (map: Map<string, number>, code: string, value: number) =>
      map.set(code, round2((map.get(code) ?? 0) + value));
    for (const shipment of shipments) {
      const confirmed = shipment.carrierCharges.filter(
        (c) => c.reconciliationState === 'CONFIRMED',
      );
      if (confirmed.length === 0) {
        estimated = round2(
          estimated +
            Number(shipment.baseShippingCost ?? 0) +
            Number(shipment.additionalShippingCost ?? 0),
        );
      }
      for (const charge of shipment.carrierCharges) {
        const sign = charge.chargeKind === 'CREDIT' ? -1 : 1;
        const value = sign * Number(charge.chargeAmount);
        if (charge.reconciliationState === 'CONFIRMED') {
          if (charge.paidAt) add(paid, charge.currency.code, value);
        } else if (
          charge.reconciliationState === 'MATCHED' ||
          charge.reconciliationState === 'REVIEW_REQUIRED'
        ) {
          add(incurred, charge.currency.code, value);
        }
      }
      const byCode = new Map<string, typeof confirmed>();
      for (const charge of confirmed) {
        byCode.set(charge.currency.code, [
          ...(byCode.get(charge.currency.code) ?? []),
          charge,
        ]);
      }
      for (const [code, charges] of byCode) {
        add(approved, code, netConfirmedCarrierCost(charges) ?? 0);
      }
    }
    const list = (map: Map<string, number>) =>
      [...map.entries()].map(([currencyCode, amount]) => ({
        currencyCode,
        amount,
      }));
    return {
      estimated,
      incurredByCurrency: list(incurred),
      approvedByCurrency: list(approved),
      paidByCurrency: list(paid),
    };
  }

  /** Cash view for the agent's settlement currency — collections, refunds, balance, available, paid out. */
  private cashView(
    ledgerRows: Array<{
      entryType: string;
      currencyId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      memoAmount: Prisma.Decimal | null;
    }>,
    balances: Array<{
      currencyId: string;
      balance: number;
      pending: number;
      available: number;
      paidOut: number;
    }>,
    currencyId: string,
  ) {
    const position = balances.find((b) => b.currencyId === currencyId);
    const rows = ledgerRows.filter((r) => r.currencyId === currencyId);
    const total = (type: string, side: 'debit' | 'credit') =>
      sum(rows.filter((r) => r.entryType === type).map((r) => Number(r[side])));
    return {
      collectedByCompany: round2(
        total('COLLECTION_RECEIVED', 'credit') -
          total('COLLECTION_REVERSAL', 'debit'),
      ),
      collectedByAgent: sum(
        rows
          .filter((r) => r.entryType === 'COLLECTION_BY_AGENT')
          .map((r) => Number(r.memoAmount ?? 0)),
      ),
      customerRefundsByCompany: total('CUSTOMER_REFUND', 'debit'),
      balance: position?.balance ?? 0,
      pending: position?.pending ?? 0,
      availableForPayout: position?.available ?? 0,
      paidOut: position?.paidOut ?? 0,
    };
  }
}
