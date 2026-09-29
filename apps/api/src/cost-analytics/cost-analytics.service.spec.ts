import { CostAnalyticsService } from './cost-analytics.service';
import type { OrderEconomics } from '../store-orders/order-economics/order-economics.types';

/**
 * M3 (Cost Module completion) — Management P&L must never fabricate an
 * UNKNOWN order's contribution as 0, and Operating Expenses must exclude
 * the one guaranteed GL/order-side overlap (the COGS account) so COGS is
 * never counted twice. `OrderEconomicsService` itself stays untouched and
 * mocked here — these tests only verify `CostAnalyticsService`'s own
 * aggregation, never re-verify M2's own cost-state math.
 */
function makeEconomics(overrides: Partial<OrderEconomics>): OrderEconomics {
  return {
    storeOrderId: 'order-1',
    netRevenue: 100,
    items: [],
    cogs: 40,
    cogsState: 'COMPLETE',
    grossProductProfit: 60,
    grossMarginPercent: 60,
    shippingAttempts: [],
    shippingCost: 10,
    shippingState: 'COMPLETE',
    payments: [],
    paymentFeeCost: 5,
    paymentFeeState: 'COMPLETE',
    fulfillmentCost: 5,
    fulfillmentCostState: 'COMPLETE',
    fulfillmentCostSource: 'STANDARD',
    fulfillmentCostRuleName: null,
    totalDirectCost: 20,
    contributionProfit: 40,
    contributionMarginPercent: 40,
    costState: 'COMPLETE',
    ...overrides,
  };
}

function makeService(overrides: {
  scopedIds?: string[];
  scopedTotal?: number;
  economics?: Map<string, OrderEconomics>;
  incomeStatement?: unknown;
  cogsAccountId?: string | null;
}) {
  const scopedIds = overrides.scopedIds ?? ['order-1'];
  const prisma = {
    storeOrder: {
      findMany: jest.fn().mockResolvedValue(scopedIds.map((id) => ({ id }))),
      count: jest
        .fn()
        .mockResolvedValue(overrides.scopedTotal ?? scopedIds.length),
    },
    product: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const orderEconomicsService = {
    getSummaryForOrders: jest
      .fn()
      .mockResolvedValue(overrides.economics ?? new Map()),
  };
  const accountingReportsService = {
    incomeStatement: jest.fn().mockResolvedValue(
      overrides.incomeStatement ?? {
        revenue: [],
        expense: [],
        totals: { totalRevenue: 0, totalExpense: 0, netIncome: 0 },
      },
    ),
  };
  const postingSettingsService = {
    get: jest.fn().mockResolvedValue({
      costOfGoodsSoldAccountId: overrides.cogsAccountId ?? null,
    }),
  };
  const service = new CostAnalyticsService(
    prisma as never,
    orderEconomicsService as never,
    accountingReportsService as never,
    postingSettingsService as never,
  );
  return {
    service,
    prisma,
    orderEconomicsService,
    accountingReportsService,
    postingSettingsService,
  };
}

describe('CostAnalyticsService.getManagementPnl', () => {
  it('sums Contribution Profit purely from OrderEconomicsService — never recomputes COGS/direct costs itself', async () => {
    const economics = new Map([
      [
        'order-1',
        makeEconomics({
          storeOrderId: 'order-1',
          netRevenue: 100,
          cogs: 40,
          contributionProfit: 40,
        }),
      ],
      [
        'order-2',
        makeEconomics({
          storeOrderId: 'order-2',
          netRevenue: 200,
          cogs: 80,
          contributionProfit: 90,
        }),
      ],
    ]);
    const { service } = makeService({
      scopedIds: ['order-1', 'order-2'],
      economics,
    });

    const result = await service.getManagementPnl({});

    expect(result.revenue).toBe(300);
    expect(result.cogs).toBe(120);
    expect(result.contributionProfit).toBe(130);
  });

  it('excludes the GL COGS account from Operating Expenses — never double-counts COGS', async () => {
    const { service } = makeService({
      economics: new Map([['order-1', makeEconomics({})]]),
      cogsAccountId: 'acct-cogs',
      incomeStatement: {
        revenue: [
          {
            accountId: 'acct-rev',
            accountCode: 'R1',
            accountName: 'Sales',
            balance: 100,
          },
        ],
        expense: [
          {
            accountId: 'acct-cogs',
            accountCode: 'E1',
            accountName: 'COGS',
            balance: 40,
          },
          {
            accountId: 'acct-marketing',
            accountCode: 'E2',
            accountName: 'Marketing',
            balance: 15,
          },
        ],
        totals: { totalRevenue: 100, totalExpense: 55, netIncome: 45 },
        accountLines: {
          'acct-rev': { line: 'REVENUE', sellingLine: null },
          'acct-cogs': { line: 'COST_OF_SALES', sellingLine: null },
          'acct-marketing': {
            line: 'SELLING_DISTRIBUTION',
            sellingLine: 'OTHER_SELLING',
          },
        },
      },
    });

    const result = await service.getManagementPnl({});

    expect(result.operatingExpenses.total).toBe(15);
    expect(result.operatingExpenses.accounts).toHaveLength(1);
    expect(result.operatingExpenses.accounts[0].accountId).toBe(
      'acct-marketing',
    );
    expect(result.operatingProfit).toBe(round2(result.contributionProfit - 15));
    expect(result.glReconciliation.netProfitFromGl).toBe(45);
  });

  it('counts shipping, gateway fees and fulfilment once and reconciles to the Income Statement operating profit', async () => {
    // One order: revenue 100, COGS 40, shipping 10, fees 5, fulfilment 5 → contribution 40.
    // GL (same Cairo period): COGS 40, shipping 12, gateway 5, fulfilment 5,
    // marketing 15, rent 30, purchase discount (revenue-type, admin) 3,
    // finance cost 7. IS: net revenue 100, selling 37, admin 27, OP −4.
    const row = (accountId: string, balance: number) => ({
      accountId,
      accountCode: accountId,
      accountName: accountId,
      balance,
    });
    const { service } = makeService({
      economics: new Map([['order-1', makeEconomics({})]]),
      cogsAccountId: '511',
      incomeStatement: {
        revenue: [row('411', 100), row('PDISC', 3)],
        expense: [
          row('511', 40),
          row('521', 12),
          row('522', 5),
          row('523', 5),
          row('529', 15),
          row('531', 30),
          row('549', 7),
        ],
        totals: {
          totalRevenue: 103,
          totalExpense: 114,
          netIncome: -11,
          netRevenue: 100,
          costOfSales: 40,
          shippingDelivery: 12,
          paymentGatewayFees: 5,
          fulfillment: 5,
          sellingDistribution: 37,
          administrative: 27,
          operatingProfit: -4,
        },
        accountLines: {
          '411': { line: 'REVENUE', sellingLine: null },
          PDISC: { line: 'ADMINISTRATIVE', sellingLine: null },
          '511': { line: 'COST_OF_SALES', sellingLine: null },
          '521': {
            line: 'SELLING_DISTRIBUTION',
            sellingLine: 'SHIPPING_DELIVERY',
          },
          '522': {
            line: 'SELLING_DISTRIBUTION',
            sellingLine: 'PAYMENT_GATEWAY_FEES',
          },
          '523': { line: 'SELLING_DISTRIBUTION', sellingLine: 'FULFILLMENT' },
          '529': { line: 'SELLING_DISTRIBUTION', sellingLine: 'OTHER_SELLING' },
          '531': { line: 'ADMINISTRATIVE', sellingLine: null },
          '549': { line: 'FINANCE_COSTS', sellingLine: null },
        },
      },
    });

    const result = await service.getManagementPnl({});

    expect(result.contributionProfit).toBe(40);
    // Before: every non-COGS expense (12+5+5+15+30+7 = 74) → OP −34 (22 double counted).
    // Now: only other selling + G&A (15 + 30 − 3 = 42) → OP −2.
    expect(result.operatingExpenses.total).toBe(42);
    expect(result.operatingExpenses.accounts.map((a) => a.accountId)).toEqual([
      '529',
      '531',
      'PDISC',
    ]);
    expect(result.operatingProfit).toBe(-2);
    expect(result.attributedCostsInGl).toEqual({
      costOfSales: 40,
      shipping: 12,
      paymentFees: 5,
      fulfillment: 5,
    });
    const rec = result.incomeStatementReconciliation;
    expect(rec).toMatchObject({
      managementOperatingProfit: -2,
      incomeStatementOperatingProfit: -4,
      difference: 2,
      balanced: true,
    });
    // The whole difference is shipping: order-level 10 vs GL 12.
    expect(rec.bridge.find((b) => b.key === 'SHIPPING')).toEqual({
      key: 'SHIPPING',
      orderLevel: 10,
      gl: 12,
      effect: 2,
    });
    expect(
      rec.bridge
        .filter((b) => b.key !== 'SHIPPING')
        .every((b) => b.effect === 0),
    ).toBe(true);
  });

  it('filters orders by Africa/Cairo business days (same period as the Income Statement)', async () => {
    const { service, prisma, accountingReportsService } = makeService({});
    await service.getManagementPnl({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
    });
    const [[{ where }]] = prisma.storeOrder.findMany.mock.calls as Array<
      [{ where: { orderDate?: unknown } }]
    >;
    // 00:00 Cairo on 1 Oct (UTC+3) … start of 1 Nov (UTC+2, after DST ends).
    expect(where.orderDate).toEqual({
      gte: new Date('2026-09-30T21:00:00.000Z'),
      lt: new Date('2026-10-31T22:00:00.000Z'),
    });
    expect(accountingReportsService.incomeStatement).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-10-01', dateTo: '2026-10-31' }),
    );
  });

  it('never fabricates an UNKNOWN order as a zero — coverage reports it, the sum still reflects only what OrderEconomicsService actually returned', async () => {
    const economics = new Map([
      [
        'order-1',
        makeEconomics({ storeOrderId: 'order-1', costState: 'COMPLETE' }),
      ],
      [
        'order-2',
        makeEconomics({
          storeOrderId: 'order-2',
          netRevenue: 0,
          cogs: 0,
          grossProductProfit: 0,
          shippingCost: 0,
          paymentFeeCost: 0,
          fulfillmentCost: 0,
          totalDirectCost: 0,
          contributionProfit: 0,
          costState: 'UNKNOWN',
        }),
      ],
    ]);
    const { service } = makeService({
      scopedIds: ['order-1', 'order-2'],
      economics,
    });

    const result = await service.getManagementPnl({});

    expect(result.coverage.orderCount).toBe(2);
    expect(result.coverage.complete).toBe(1);
    expect(result.coverage.unknown).toBe(1);
    expect(result.costState).toBe('PARTIAL');
  });

  it('reports truncated:true when the scoped order count exceeds the fetched page', async () => {
    const { service } = makeService({
      scopedIds: ['order-1'],
      scopedTotal: 50_000,
    });

    const result = await service.getManagementPnl({});

    expect(result.scope.truncated).toBe(true);
    expect(result.scope.scopedOrderCount).toBe(50_000);
  });
});

describe('CostAnalyticsService.getProfitabilityAnalytics — PRODUCT dimension', () => {
  it('never fabricates a per-product Contribution Profit — totalDirectCost/contributionProfit stay null', async () => {
    const economics = new Map([
      [
        'order-1',
        makeEconomics({
          storeOrderId: 'order-1',
          items: [
            {
              productId: 'p1',
              quantity: 2,
              netRevenue: 100,
              historicalUnitCost: 20,
              cogs: 40,
            },
          ],
        }),
      ],
    ]);
    const { service } = makeService({ economics });

    const result = await service.getProfitabilityAnalytics({
      dimension: 'PRODUCT',
      page: 1,
      pageSize: 50,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].totalDirectCost).toBeNull();
    expect(result.rows[0].contributionProfit).toBeNull();
    expect(result.rows[0].grossProfit).toBe(60);
    expect(result.rows[0].totalQuantity).toBe(2);
  });

  it('an item with unknown COGS is excluded from the product cogs sum, never counted as 0', async () => {
    const economics = new Map([
      [
        'order-1',
        makeEconomics({
          storeOrderId: 'order-1',
          items: [
            {
              productId: 'p1',
              quantity: 1,
              netRevenue: 50,
              historicalUnitCost: null,
              cogs: null,
            },
          ],
        }),
      ],
    ]);
    const { service } = makeService({ economics });

    const result = await service.getProfitabilityAnalytics({
      dimension: 'PRODUCT',
      page: 1,
      pageSize: 50,
    });

    expect(result.rows[0].cogs).toBe(0);
    expect(result.rows[0].costState).toBe('UNKNOWN');
  });
});

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
