import {
  AgentPricingError,
  agentCommissionAmount,
  allocateMinor,
  computeAgentOrderPricing,
} from './agent-order-pricing';

describe('agent order pricing (spec §5)', () => {
  it('A — shipping added: 1,000 merchandise + 100 shipping = 1,100 payable', () => {
    const b = computeAgentOrderPricing({
      mode: 'SHIPPING_ADDED',
      lines: [{ key: 'p1', quantity: 1, lineAmount: 1000 }],
      shippingCharge: 100,
    });
    expect(b.merchandiseAmount).toBe(1000);
    expect(b.shippingCharge).toBe(100);
    expect(b.payableTotal).toBe(1100);
  });

  it('B — shipping included: 1,000 total incl. 100 ⇒ 900 merchandise + 100 shipping', () => {
    const b = computeAgentOrderPricing({
      mode: 'SHIPPING_INCLUDED',
      lines: [{ key: 'p1', quantity: 1 }],
      agreedTotal: 1000,
      shippingCharge: 100,
    });
    expect(b.merchandiseAmount).toBe(900);
    expect(b.shippingCharge).toBe(100);
    expect(b.payableTotal).toBe(1000);
    expect(b.lines[0].lineAmount).toBe(900);
  });

  it('B never charges shipping twice (payable = agreed total)', () => {
    const b = computeAgentOrderPricing({
      mode: 'SHIPPING_INCLUDED',
      lines: [{ key: 'p1', quantity: 2, listUnitPrice: 600 }],
      agreedTotal: 1000,
      shippingCharge: 100,
    });
    expect(b.payableTotal).toBe(1000);
    expect(b.merchandiseAmount + b.shippingCharge).toBe(1000);
  });

  it('B requires the agreed total', () => {
    expect(() =>
      computeAgentOrderPricing({
        mode: 'SHIPPING_INCLUDED',
        lines: [{ key: 'p1', quantity: 1 }],
        shippingCharge: 100,
      }),
    ).toThrow(AgentPricingError);
  });

  it('B rejects shipping ≥ agreed total (no negative merchandise)', () => {
    try {
      computeAgentOrderPricing({
        mode: 'SHIPPING_INCLUDED',
        lines: [{ key: 'p1', quantity: 1 }],
        agreedTotal: 100,
        shippingCharge: 100,
      });
      fail('expected error');
    } catch (e) {
      expect((e as AgentPricingError).code).toBe('CHARGES_EXCEED_TOTAL');
    }
  });

  it('B allocates by list price with exact cents (largest remainder, deterministic)', () => {
    const b = computeAgentOrderPricing({
      mode: 'SHIPPING_INCLUDED',
      lines: [
        { key: 'a', quantity: 1, listUnitPrice: 100 },
        { key: 'b', quantity: 1, listUnitPrice: 100 },
        { key: 'c', quantity: 1, listUnitPrice: 100 },
      ],
      agreedTotal: 150,
      shippingCharge: 50,
    });
    expect(b.lines.map((l) => l.lineAmount)).toEqual([33.34, 33.33, 33.33]);
    expect(b.merchandiseAmount).toBe(100);
    const again = computeAgentOrderPricing({
      mode: 'SHIPPING_INCLUDED',
      lines: [
        { key: 'a', quantity: 1, listUnitPrice: 100 },
        { key: 'b', quantity: 1, listUnitPrice: 100 },
        { key: 'c', quantity: 1, listUnitPrice: 100 },
      ],
      agreedTotal: 150,
      shippingCharge: 50,
    });
    expect(again).toEqual(b);
  });

  it('B prefers entered line amounts as weights, then quantity', () => {
    const byEntered = computeAgentOrderPricing({
      mode: 'SHIPPING_INCLUDED',
      lines: [
        { key: 'a', quantity: 1, lineAmount: 300 },
        { key: 'b', quantity: 1, lineAmount: 100 },
      ],
      agreedTotal: 500,
      shippingCharge: 100,
    });
    expect(byEntered.lines.map((l) => l.lineAmount)).toEqual([300, 100]);
    const byQty = computeAgentOrderPricing({
      mode: 'SHIPPING_INCLUDED',
      lines: [
        { key: 'a', quantity: 3 },
        { key: 'b', quantity: 1 },
      ],
      agreedTotal: 500,
      shippingCharge: 100,
    });
    expect(byQty.lines.map((l) => l.lineAmount)).toEqual([300, 100]);
  });

  it('A requires every line amount and rejects negatives and sub-cent values', () => {
    expect(() =>
      computeAgentOrderPricing({
        mode: 'SHIPPING_ADDED',
        lines: [{ key: 'p1', quantity: 1 }],
        shippingCharge: 0,
      }),
    ).toThrow(AgentPricingError);
    expect(() =>
      computeAgentOrderPricing({
        mode: 'SHIPPING_ADDED',
        lines: [{ key: 'p1', quantity: 1, lineAmount: -5 }],
        shippingCharge: 0,
      }),
    ).toThrow(AgentPricingError);
    expect(() =>
      computeAgentOrderPricing({
        mode: 'SHIPPING_ADDED',
        lines: [{ key: 'p1', quantity: 1, lineAmount: 10.005 }],
        shippingCharge: 0,
      }),
    ).toThrow(AgentPricingError);
  });

  it('rejects fractional or zero quantities', () => {
    expect(() =>
      computeAgentOrderPricing({
        mode: 'SHIPPING_ADDED',
        lines: [{ key: 'p1', quantity: 0, lineAmount: 10 }],
        shippingCharge: 0,
      }),
    ).toThrow(AgentPricingError);
  });

  it('keeps the service charge separate from shipping', () => {
    const b = computeAgentOrderPricing({
      mode: 'SHIPPING_ADDED',
      lines: [{ key: 'course', quantity: 1, lineAmount: 500 }],
      shippingCharge: 0,
      serviceCharge: 25,
    });
    expect(b.shippingCharge).toBe(0);
    expect(b.serviceCharge).toBe(25);
    expect(b.payableTotal).toBe(525);
  });

  it('reports the list-price discount per line', () => {
    const b = computeAgentOrderPricing({
      mode: 'SHIPPING_ADDED',
      lines: [{ key: 'p1', quantity: 2, lineAmount: 900, listUnitPrice: 500 }],
      shippingCharge: 0,
    });
    expect(b.discountAmount).toBe(100);
    expect(b.lines[0].unitPrice).toBe(450);
  });

  it('allocateMinor sums exactly', () => {
    const parts = allocateMinor(1001, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1001);
    expect(parts).toEqual([334, 334, 333]);
  });

  it('commission excludes shipping: 10% of 900 merchandise = 90', () => {
    expect(agentCommissionAmount(900, 10)).toBe(90);
    expect(agentCommissionAmount(333.33, 7.5)).toBe(25);
  });
});
