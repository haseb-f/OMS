import {
  appliedCreditByReturn,
  computeInvoicePaymentSummary,
  resolveInvoicePaymentStatus,
  type ReturnCredit,
} from './invoice-payment.util';
import { assertFeeWithinAmount } from './fee-cap';

describe('R22 D2 — the one invoice settlement rule', () => {
  it('cash only: UNPAID → PARTIALLY_PAID → PAID', () => {
    expect(computeInvoicePaymentSummary(200_000, 0)).toMatchObject({
      paidTotal: 0,
      creditedTotal: 0,
      remainingBalance: 200_000,
      paymentStatus: 'UNPAID',
    });
    expect(computeInvoicePaymentSummary(200_000, 100_000)).toMatchObject({
      paidTotal: 100_000,
      allocatedTotal: 100_000,
      remainingBalance: 100_000,
      paymentStatus: 'PARTIALLY_PAID',
    });
    expect(computeInvoicePaymentSummary(200_000, 200_000)).toMatchObject({
      remainingBalance: 0,
      paymentStatus: 'PAID',
    });
  });

  it('a credit note settles what the cash left open — SETTLED, never counted as paid', () => {
    expect(computeInvoicePaymentSummary(200_000, 150_000, 50_000)).toEqual({
      grandTotal: 200_000,
      paidTotal: 150_000,
      allocatedTotal: 150_000,
      creditedTotal: 50_000,
      remainingBalance: 0,
      paymentStatus: 'SETTLED',
    });
    // Credit beyond the open balance stays on the return (surplus).
    expect(computeInvoicePaymentSummary(100, 80, 50)).toMatchObject({
      creditedTotal: 20,
      remainingBalance: 0,
      paymentStatus: 'SETTLED',
    });
    // Cash already covers it: the credit applies to nothing.
    expect(computeInvoicePaymentSummary(100, 100, 50)).toMatchObject({
      creditedTotal: 0,
      paymentStatus: 'PAID',
    });
    // Credit alone, a balance left: not "paid".
    expect(computeInvoicePaymentSummary(1_000, 0, 300)).toMatchObject({
      creditedTotal: 300,
      remainingBalance: 700,
      paymentStatus: 'UNPAID',
    });
  });

  it('a cancelled invoice reports CANCELLED with its real figures', () => {
    expect(
      resolveInvoicePaymentStatus(
        computeInvoicePaymentSummary(100, 40),
        'CANCELLED',
      ),
    ).toMatchObject({ paidTotal: 40, paymentStatus: 'CANCELLED' });
  });

  it('applied credit is taken from the oldest return first; the rest stays unapplied', () => {
    const credit = (returnId: string, available: number): ReturnCredit => ({
      returnId,
      invoiceId: 'inv',
      partnerId: 'p',
      currencyId: null,
      postedAt: new Date(),
      available,
    });
    const applied = appliedCreditByReturn(
      [credit('r1', 30), credit('r2', 50)],
      new Map([['inv', 60]]),
    );
    expect(Object.fromEntries(applied)).toEqual({ r1: 30, r2: 30 });
  });
});

describe('R22 D5 — fee cap', () => {
  it('a fee up to the amount passes, above it is FEE_EXCEEDS_AMOUNT', () => {
    expect(() => assertFeeWithinAmount(100, 100)).not.toThrow();
    let error: unknown;
    try {
      assertFeeWithinAmount(100.01, 100);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      response: { code: 'FEE_EXCEEDS_AMOUNT' },
    });
  });
});
