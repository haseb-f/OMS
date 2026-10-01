import {
  AgentCommissionRateMissingError,
  AgentItemTypeMissingError,
  commissionExample,
  commissionReversalByLine,
  computeOrderCommission,
  legacyLineCommissionRate,
  resolveLineCommissionRate,
  settleAgentShipping,
  type AgentCommissionClass,
  type AgentLineCommissionRate,
} from './agent-commission';

const agreement = {
  productCommissionRatePercent: 35,
  serviceCommissionRatePercent: 25,
};

const rate = (
  itemType: AgentCommissionClass | null,
  override: number | null = null,
) =>
  resolveLineCommissionRate({
    productId: 'p-1',
    itemType,
    agreement,
    override: override == null ? null : { id: 'ov-1', ratePercent: override },
  });

const line = (
  key: string,
  salesAmount: number,
  r: AgentLineCommissionRate,
  returnedBeforeEarning = 0,
) => ({
  key,
  productId: `p-${key}`,
  storeOrderItemId: `i-${key}`,
  salesAmount,
  returnedBeforeEarning,
  rate: r,
});

describe('agent commission (commission-policy.md)', () => {
  it('A1 — commission by item type: 100,000 products @35% + 100,000 services @25% = 60,000', () => {
    const result = computeOrderCommission([
      line('a', 100_000, rate('PRODUCT')),
      line('b', 100_000, rate('SERVICE')),
    ]);
    expect(result.commission).toBe(60_000);
    expect(result.byClass.PRODUCT).toEqual({
      sales: 100_000,
      base: 100_000,
      commission: 35_000,
    });
    expect(result.byClass.SERVICE.commission).toBe(25_000);
  });

  it('A1 — shipping example: 1,000 + 100 shipping, 35% ⇒ company 450, agent 650 (no second 100)', () => {
    const example = commissionExample({
      productSales: 1_000,
      serviceSales: 0,
      productRatePercent: 35,
      serviceRatePercent: 25,
      customerShipping: 100,
      predeterminedShippingCharge: 100,
    });
    expect(example).toMatchObject({
      totalCollected: 1_100,
      productCommission: 350,
      customerShipping: 100,
      predeterminedShippingCharge: 100,
      shippingAppliedToCharge: 100,
      shippingDifference: 0,
      companyRetains: 450,
      agentEntitlement: 650,
    });
  });

  it('A6 + O1 — retained customer shipping settles the predetermined charge; the company bears / keeps a difference', () => {
    expect(
      settleAgentShipping({ customerShipping: 100, predeterminedCharge: 100 }),
    ).toEqual({
      retained: 100,
      appliedToAgentShippingCharge: 100,
      difference: 0,
      differenceBorneBy: 'COMPANY',
    });
    expect(
      settleAgentShipping({ customerShipping: 80, predeterminedCharge: 100 }),
    ).toEqual({
      retained: 80,
      appliedToAgentShippingCharge: 80,
      difference: -20,
      differenceBorneBy: 'COMPANY',
    });
    expect(
      settleAgentShipping({ customerShipping: 120, predeterminedCharge: 100 }),
    ).toEqual({
      retained: 120,
      appliedToAgentShippingCharge: 100,
      difference: 20,
      differenceBorneBy: 'COMPANY',
    });
    expect(
      settleAgentShipping({ customerShipping: 0, predeterminedCharge: 0 }),
    ).toMatchObject({ retained: 0, difference: 0 });
  });

  it.each([
    [80, 100],
    [120, 100],
    [100, 100],
  ])(
    'O1 — sales 1,000 @35%%, customer shipping %d vs fee %d ⇒ agent entitlement 650',
    (customerShipping, predeterminedShippingCharge) => {
      const example = commissionExample({
        productSales: 1_000,
        serviceSales: 0,
        productRatePercent: 35,
        serviceRatePercent: 25,
        customerShipping,
        predeterminedShippingCharge,
      });
      expect(example.agentEntitlement).toBe(650);
      expect(example.companyRetains).toBe(350 + customerShipping);
      expect(example.shippingDifference).toBe(
        customerShipping - predeterminedShippingCharge,
      );
    },
  );

  it('A2 — class is the explicit item type (never the stock flag); A4 — agreement rate by type', () => {
    expect(rate('PRODUCT')).toEqual({
      commissionClass: 'PRODUCT',
      rateSource: 'AGREEMENT_PRODUCT',
      ratePercent: 35,
      overrideId: null,
    });
    expect(rate('SERVICE')).toMatchObject({
      commissionClass: 'SERVICE',
      rateSource: 'AGREEMENT_SERVICE',
      ratePercent: 25,
    });
  });

  it('A2 — an unclassified item is refused, never guessed', () => {
    expect(() => rate(null)).toThrow(AgentItemTypeMissingError);
  });

  it('A4 — an item override wins, and an explicit 0% override stays 0%', () => {
    expect(rate('PRODUCT', 12.5)).toMatchObject({
      rateSource: 'ITEM_OVERRIDE',
      ratePercent: 12.5,
      overrideId: 'ov-1',
    });
    const zero = rate('SERVICE', 0);
    expect(zero).toMatchObject({ rateSource: 'ITEM_OVERRIDE', ratePercent: 0 });
    expect(computeOrderCommission([line('z', 5_000, zero)]).commission).toBe(0);
  });

  it('A4 — a missing rate throws instead of silently becoming 0%', () => {
    expect(() =>
      resolveLineCommissionRate({
        productId: 'p-1',
        itemType: 'SERVICE',
        agreement: {
          productCommissionRatePercent: 35,
          serviceCommissionRatePercent: null,
        },
        override: null,
      }),
    ).toThrow(AgentCommissionRateMissingError);
  });

  it('A5 — mixed order: per-line rounding, then aggregated', () => {
    const result = computeOrderCommission([
      line('a', 333.33, rate('PRODUCT')), // 116.6655 → 116.67
      line('b', 199.99, rate('SERVICE')), // 49.9975 → 50.00
      line('c', 10.01, rate('PRODUCT', 0)),
    ]);
    expect(result.lines.map((l) => l.commission)).toEqual([116.67, 50, 0]);
    expect(result.commission).toBe(166.67);
    expect(result.base).toBe(543.33);
  });

  it('A5 — returns before earning reduce only their own line base', () => {
    const result = computeOrderCommission([
      line('a', 1_000, rate('PRODUCT'), 400),
      line('b', 1_000, rate('SERVICE')),
    ]);
    expect(result.lines[0].baseAmount).toBe(600);
    expect(result.lines[0].commission).toBe(210);
    expect(result.lines[1].commission).toBe(250);
  });

  it('A5 — reversal per line, cumulative, capped at the line commission', () => {
    const first = commissionReversalByLine([
      {
        key: 'a',
        commission: 350,
        baseAmount: 1_000,
        returnedAfterEarning: 250,
        alreadyReversed: 0,
      },
      {
        key: 'b',
        commission: 250,
        baseAmount: 1_000,
        returnedAfterEarning: 0,
        alreadyReversed: 0,
      },
    ]);
    expect(first.map((l) => l.reversal)).toEqual([87.5, 0]);
    const second = commissionReversalByLine([
      {
        key: 'a',
        commission: 350,
        baseAmount: 1_000,
        returnedAfterEarning: 1_500,
        alreadyReversed: 87.5,
      },
    ]);
    expect(second[0].reversal).toBe(262.5);
  });

  it('legacy snapshots keep their single rate; an unclassified legacy item has no class', () => {
    expect(legacyLineCommissionRate(null, 10)).toEqual({
      commissionClass: null,
      rateSource: 'LEGACY_SINGLE_RATE',
      ratePercent: 10,
      overrideId: null,
    });
    expect(legacyLineCommissionRate('SERVICE', 10).commissionClass).toBe(
      'SERVICE',
    );
  });

  it('legacy single-rate orders keep order-level rounding (residue spread over lines)', () => {
    const legacy = legacyLineCommissionRate('PRODUCT', 10);
    const result = computeOrderCommission([
      line('a', 0.05, legacy),
      line('b', 0.05, legacy),
      line('c', 0.05, legacy),
    ]);
    // Order level: 10% of 0.15 = 0.015 → 0.02 (per line it would be 0.03).
    expect(result.commission).toBe(0.02);
    expect(
      result.lines.reduce((sum, l) => sum + Math.round(l.commission * 100), 0),
    ).toBe(2);
  });
});
