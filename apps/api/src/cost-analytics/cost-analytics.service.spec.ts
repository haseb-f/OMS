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
