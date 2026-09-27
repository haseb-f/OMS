import {
  calculateSettlement,
  SettlementCalculationError,
  type CalculatorInput,
} from './settlement-calculator';

const accounts = {
  bankAccountId: 'bank',
  commissionAccountId: 'commission',
  clearingAccountId: 'clearing',
  exchangeDifferenceAccountId: 'fx',
};
const labels = { bank: 'b', commission: 'c', clearing: 'cl', fx: 'fx' };

function claims(count: number, amount: number, rate: number) {
  return Array.from({ length: count }, (_, i) => ({
    paymentId: `p${i}`,
    amount,
    settledAmount: 0,
    carryingTotal: Math.round(amount * rate * 100) / 100,
    carryingReleased: 0,
    receiptRate: rate,
  }));
}

function base(overrides: Partial<CalculatorInput>): CalculatorInput {
  return {
    claims: claims(10, 500, 1),
    sameCurrency: true,
    receivedAmount: 4500,
    claimRate: 1,
    receivedRate: 1,
    accounts,
    labels,
    ...overrides,
  };
}

function totals(result: ReturnType<typeof calculateSettlement>) {
  const debit = result.jeLines.reduce((s, l) => s + l.debit, 0);
  const credit = result.jeLines.reduce((s, l) => s + l.credit, 0);
  return {
    debit: Math.round(debit * 100) / 100,
    credit: Math.round(credit * 100) / 100,
  };
}

function roles(result: ReturnType<typeof calculateSettlement>) {
  return Object.fromEntries(
    result.jeLines.map((l) => [l.role, { debit: l.debit, credit: l.credit }]),
  );
}

function expectCode(fn: () => unknown, code: string) {
  let caught: unknown = null;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SettlementCalculationError);
  expect((caught as SettlementCalculationError).code).toBe(code);
}

describe('calculateSettlement', () => {
  it('same currency = functional: 10 × 500 received 4,500 → fee 500, no FX line', () => {
    const result = calculateSettlement(base({}));
    expect(result.grossAmount).toBe('5000.00');
    expect(result.feeAmount).toBe('500.00');
    expect(result.functional.fxDifference).toBe('0.00');
    expect(roles(result)).toEqual({
      BANK: { debit: 4500, credit: 0 },
      COMMISSION: { debit: 500, credit: 0 },
      CLEARING: { debit: 0, credit: 5000 },
    });
    expect(totals(result)).toEqual({ debit: 5000, credit: 5000 });
  });

  it('same foreign currency, functional differs: clearing at receipt rates, bank/fee at settlement rate, FX separate', () => {
    // SAR claims booked at 13.00 → carrying 65,000; settled at 13.20.
    const result = calculateSettlement(
      base({
        claims: claims(10, 500, 13),
        claimRate: 13.2,
        receivedRate: 13.2,
      }),
    );
    expect(result.feeAmount).toBe('500.00');
    expect(result.functional).toEqual({
      bank: '59400.00',
      commission: '6600.00',
      clearing: '65000.00',
      fxDifference: '-1000.00',
    });
    expect(roles(result).FX_DIFFERENCE).toEqual({ debit: 0, credit: 1000 });
    expect(roles(result).COMMISSION).toEqual({ debit: 6600, credit: 0 });
    expect(totals(result)).toEqual({ debit: 66000, credit: 66000 });
  });

  it('cross-currency uses the entered fee and a balancing FX line (loss → debit)', () => {
    const result = calculateSettlement(
      base({
        claims: claims(10, 500, 13),
        sameCurrency: false,
        receivedAmount: 58000,
        feeAmount: 500,
        claimRate: 13.2,
        receivedRate: 1,
      }),
    );
    expect(result.feeAmount).toBe('500.00');
    expect(roles(result)).toEqual({
      BANK: { debit: 58000, credit: 0 },
      COMMISSION: { debit: 6600, credit: 0 },
      FX_DIFFERENCE: { debit: 400, credit: 0 },
      CLEARING: { debit: 0, credit: 65000 },
    });
    expect(totals(result)).toEqual({ debit: 65000, credit: 65000 });
  });

  it('cross-currency without a fee is refused (never subtracts unlike currencies)', () => {
    expectCode(
      () =>
        calculateSettlement(base({ sameCurrency: false, receivedAmount: 100 })),
      'FEE_REQUIRED',
    );
  });

  it('refuses an over-receipt in the same currency', () => {
    expectCode(
      () => calculateSettlement(base({ receivedAmount: 5000.01 })),
      'OVER_RECEIPT',
    );
  });

  it('explicit partial settlement releases a proportional carrying value; the last portion releases the rest', () => {
    const first = calculateSettlement(
      base({
        claims: [{ ...claims(1, 500, 13.333)[0], requestedAmount: 200 }],
        receivedAmount: 190,
        claimRate: 13.333,
        receivedRate: 13.333,
      }),
    );
    expect(first.lines[0]).toMatchObject({
      amount: '200.00',
      fullyReleases: false,
      carryingAmountFunctional: '2666.60',
    });
    const second = calculateSettlement(
      base({
        claims: [
          {
            ...claims(1, 500, 13.333)[0],
            settledAmount: 200,
            carryingReleased: 2666.6,
          },
        ],
        receivedAmount: 300,
        claimRate: 13.333,
        receivedRate: 13.333,
      }),
    );
    expect(second.lines[0]).toMatchObject({
      amount: '300.00',
      fullyReleases: true,
      // 6666.50 total − 2666.60 released: no rounding residue left in clearing.
      carryingAmountFunctional: '3999.90',
    });
  });

  it('refuses a settle amount above the unsettled remainder', () => {
    expect(() =>
      calculateSettlement(
        base({
          claims: [
            {
              ...claims(1, 500, 1)[0],
              settledAmount: 400,
              requestedAmount: 101,
            },
          ],
          receivedAmount: 100,
        }),
      ),
    ).toThrow(SettlementCalculationError);
  });

  it('requires the exchange difference account only when an FX difference arises', () => {
    expectCode(
      () =>
        calculateSettlement(
          base({
            claims: claims(1, 500, 13),
            receivedAmount: 450,
            claimRate: 13.2,
            receivedRate: 13.2,
            accounts: { ...accounts, exchangeDifferenceAccountId: null },
          }),
        ),
      'EXCHANGE_DIFFERENCE_ACCOUNT_NOT_CONFIGURED',
    );
    expect(() =>
      calculateSettlement(
        base({ accounts: { ...accounts, exchangeDifferenceAccountId: null } }),
      ),
    ).not.toThrow();
  });
});
