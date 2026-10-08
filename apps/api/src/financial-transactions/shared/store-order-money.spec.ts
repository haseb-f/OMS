import { advanceRateOf, computeStoreOrderMoney } from './store-order-money';

/**
 * R15 (D15-9 … D15-11) — the one order money position. Refund due is only
 * money actually collected beyond what the customer owes; a credit note
 * alone never makes anything "refunded".
 */
describe('computeStoreOrderMoney', () => {
  const base = {
    active: true,
    payable: 200,
    collected: 0,
    invoiced: 0,
    returns: [] as { grandTotal: number; refunded: number }[],
    refundedAdvance: 0,
  };

  it('prepaid before delivery: the advance pays for goods still to come — no refund due', () => {
    const figures = computeStoreOrderMoney({ ...base, collected: 200 });
    expect(figures.expected).toBe(200);
    expect(figures.balanceDue).toBe(0);
    expect(figures.refundDue).toBe(0);
  });

  it('cancelled (archived) prepaid order: everything collected is due back as an advance refund', () => {
    const figures = computeStoreOrderMoney({
      ...base,
      active: false,
      collected: 200,
    });
    expect(figures.expected).toBe(0);
    expect(figures.refundDue).toBe(200);
    expect(figures.advanceRefundable).toBe(200);
  });

  it('paid, delivered, one item returned: refund due = the credit note, refunded on the note (not the advance)', () => {
    const figures = computeStoreOrderMoney({
      ...base,
      collected: 200,
      invoiced: 200,
      returns: [{ grandTotal: 100, refunded: 0 }],
    });
    expect(figures.credited).toBe(100);
    expect(figures.expected).toBe(100);
    expect(figures.refundDue).toBe(100);
    expect(figures.unrefundedReturnCredit).toBe(100);
    expect(figures.advanceRefundable).toBe(0);

    const refunded = computeStoreOrderMoney({
      ...base,
      collected: 200,
      invoiced: 200,
      returns: [{ grandTotal: 100, refunded: 100 }],
    });
    expect(refunded.refunded).toBe(100);
    expect(refunded.refundDue).toBe(0);
    expect(refunded.balanceDue).toBe(0);
  });

  it('COD never collected: the credit note only reduces what is owed — nothing to refund', () => {
    const figures = computeStoreOrderMoney({
      ...base,
      invoiced: 200,
      returns: [{ grandTotal: 100, refunded: 0 }],
    });
    expect(figures.refundDue).toBe(0);
    expect(figures.balanceDue).toBe(100);
  });

  it('overpayment: collected beyond the (reduced) order total is refundable against the order', () => {
    const figures = computeStoreOrderMoney({
      ...base,
      payable: 250,
      collected: 300,
      invoiced: 250,
    });
    expect(figures.refundDue).toBe(50);
    expect(figures.advanceRefundable).toBe(50);
    const after = computeStoreOrderMoney({
      ...base,
      payable: 250,
      collected: 300,
      invoiced: 250,
      refundedAdvance: 50,
    });
    expect(after.refundDue).toBe(0);
    expect(after.refunded).toBe(50);
  });
});

describe('advanceRateOf', () => {
  it('is the amount-weighted frozen rate of the receipts (null without one)', () => {
    expect(advanceRateOf([])).toBeNull();
    expect(advanceRateOf([{ settled: 100, exchangeRate: null }])).toBeNull();
    expect(
      advanceRateOf([
        { settled: 100, exchangeRate: 40 },
        { settled: 300, exchangeRate: 44 },
      ]),
    ).toBe(43);
  });
});
