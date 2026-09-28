import {
  agentCommissionAmount,
  computeAgentOrderPricing,
} from '../pricing/agent-order-pricing';
import {
  allocateFifo,
  allocateSettlementFee,
  commissionReversalAmount,
  computeAgentBalances,
  computeCollectionAvailableAt,
  eligibleCredits,
  paymentStage,
  returnedLineAmount,
  sumByType,
  withRunningBalance,
  type LedgerRowLite,
} from './agent-ledger.math';

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const DAY = 24 * 60 * 60 * 1000;

let seq = 0;
function row(partial: Partial<LedgerRowLite>): LedgerRowLite {
  seq += 1;
  return {
    id: `e${seq}`,
    entryNumber: `AL-${String(seq).padStart(4, '0')}`,
    entryType: 'ADJUSTMENT',
    entryDate: D('2026-09-01'),
    sourceType: 'X',
    sourceId: `s${seq}`,
    payoutId: null,
    currencyId: 'EGP',
    debit: 0,
    credit: 0,
    availableAt: null,
    allocated: 0,
    ...partial,
  };
}

describe('agent commission base (spec §5 examples)', () => {
  it('shipping included: 1,000 incl. 100 at 10% ⇒ commission 90 on merchandise only', () => {
    const pricing = computeAgentOrderPricing({
      mode: 'SHIPPING_INCLUDED',
      lines: [{ key: 'a', quantity: 1 }],
      agreedTotal: 1000,
      shippingCharge: 100,
    });
    expect(pricing.merchandiseAmount).toBe(900);
    expect(agentCommissionAmount(pricing.merchandiseAmount, 10)).toBe(90);
  });

  it('shipping added: 1,000 + 100 at 10% ⇒ commission 100', () => {
    const pricing = computeAgentOrderPricing({
      mode: 'SHIPPING_ADDED',
      lines: [{ key: 'a', quantity: 1, lineAmount: 1000 }],
      shippingCharge: 100,
    });
    expect(pricing.payableTotal).toBe(1100);
    expect(agentCommissionAmount(pricing.merchandiseAmount, 10)).toBe(100);
  });
});

describe('computeCollectionAvailableAt', () => {
  const base = {
    requiresReconciliation: false,
    paymentAmount: 500,
    settledAmount: 0,
    settledAt: null,
    verifiedAt: D('2026-09-02'),
    earnedAt: D('2026-09-05'),
    holdDays: 3,
  };

  it('non-reconciled: hold days from the later of earning and verification', () => {
    expect(computeCollectionAvailableAt(base)).toEqual(
      new Date(D('2026-09-05').getTime() + 3 * DAY),
    );
  });

  it('not earned yet ⇒ not determinable', () => {
    expect(
      computeCollectionAvailableAt({ ...base, earnedAt: null }),
    ).toBeNull();
  });

  it('reconciled method needs full settlement; counts from the settlement date', () => {
    const recon = { ...base, requiresReconciliation: true, holdDays: 0 };
    expect(computeCollectionAvailableAt(recon)).toBeNull();
    expect(
      computeCollectionAvailableAt({
        ...recon,
        settledAmount: 200,
        settledAt: D('2026-09-10'),
      }),
    ).toBeNull();
    expect(
      computeCollectionAvailableAt({
        ...recon,
        settledAmount: 500,
        settledAt: D('2026-09-10'),
      }),
    ).toEqual(D('2026-09-10'));
  });
});

describe('paymentStage', () => {
  const now = D('2026-09-20');
  const credit = {
    amount: 500,
    availableAt: D('2026-09-15'),
    allocated: 0,
    reversed: false,
  };
  const input = {
    status: 'VERIFIED' as const,
    destinationOwnership: 'COMPANY' as const,
    requiresReconciliation: true,
    amount: 500,
    settledAmount: 500,
    earnedAt: D('2026-09-10'),
    credit,
    now,
  };
  it('walks declared → held → settled → pending → available → paid out', () => {
    expect(paymentStage({ ...input, status: 'PENDING' })).toBe('DECLARED');
    expect(paymentStage({ ...input, settledAmount: 0 })).toBe(
      'HELD_WITH_PROVIDER',
    );
    expect(paymentStage({ ...input, earnedAt: null })).toBe('SETTLED');
    expect(
      paymentStage({
        ...input,
        credit: { ...credit, availableAt: D('2026-09-25') },
      }),
    ).toBe('PENDING_ELIGIBILITY');
    expect(paymentStage(input)).toBe('AVAILABLE');
    expect(
      paymentStage({ ...input, credit: { ...credit, allocated: 500 } }),
    ).toBe('PAID_OUT');
  });
  it('agent destination and rejection', () => {
    expect(
      paymentStage({ ...input, destinationOwnership: 'AGENT', credit: null }),
    ).toBe('COLLECTED_BY_AGENT');
    expect(paymentStage({ ...input, status: 'REJECTED' })).toBe('REJECTED');
    expect(
      paymentStage({ ...input, credit: { ...credit, reversed: true } }),
    ).toBe('REVERSED');
  });
});

describe('computeAgentBalances', () => {
  const now = D('2026-09-20');

  it('available = available credits − deductions − payouts; pending kept apart; balance = available + pending', () => {
    const rows = [
      row({
        entryType: 'COLLECTION_RECEIVED',
        credit: 1000,
        availableAt: D('2026-09-10'),
      }),
      row({ entryType: 'COLLECTION_RECEIVED', credit: 400, availableAt: null }),
      row({ entryType: 'COMMISSION', debit: 90 }),
      row({ entryType: 'SHIPPING_FEE', debit: 25 }),
      row({ entryType: 'PAYOUT', debit: 300, payoutId: 'p1' }),
    ];
    const [b] = computeAgentBalances(rows, now);
    expect(b.balance).toBe(985);
    expect(b.pending).toBe(400);
    expect(b.available).toBe(585);
    expect(b.available + b.pending).toBe(b.balance);
  });

  it('pairs reversed collections and reversed payouts out of availability', () => {
    const rows = [
      row({
        entryType: 'COLLECTION_RECEIVED',
        sourceType: 'R',
        sourceId: 'r1',
        credit: 500,
      }),
      row({
        entryType: 'COLLECTION_REVERSAL',
        sourceType: 'R',
        sourceId: 'r1',
        debit: 500,
      }),
      row({
        entryType: 'COLLECTION_RECEIVED',
        credit: 200,
        availableAt: D('2026-09-01'),
      }),
      row({ entryType: 'PAYOUT', debit: 150, payoutId: 'p1' }),
      row({ entryType: 'PAYOUT_REVERSAL', credit: 150, payoutId: 'p1' }),
    ];
    const [b] = computeAgentBalances(rows, now);
    expect(b.balance).toBe(200);
    expect(b.pending).toBe(0);
    expect(b.available).toBe(200);
    expect(b.paidOut).toBe(0);
  });

  it('negative position is floored at 0 and carried forward (D5)', () => {
    const rows = [
      row({
        entryType: 'COLLECTION_RECEIVED',
        credit: 100,
        availableAt: D('2026-09-01'),
      }),
      row({ entryType: 'PAYOUT', debit: 100, payoutId: 'p1' }),
      row({ entryType: 'CUSTOMER_REFUND', debit: 60 }),
    ];
    const [b] = computeAgentBalances(rows, now);
    expect(b.balance).toBe(-60);
    expect(b.available).toBe(0);
    expect(b.availableRaw).toBe(-60);
  });

  it('keeps currencies separate (never nets unlike currencies)', () => {
    const rows = [
      row({ entryType: 'ADJUSTMENT', credit: 100, currencyId: 'EGP' }),
      row({ entryType: 'ADJUSTMENT', debit: 30, currencyId: 'USD' }),
    ];
    const balances = computeAgentBalances(rows, now);
    expect(balances.find((b) => b.currencyId === 'EGP')?.balance).toBe(100);
    expect(balances.find((b) => b.currencyId === 'USD')?.balance).toBe(-30);
  });
});

describe('eligibleCredits + allocateFifo', () => {
  it('allocates FIFO by availableAt over unallocated remainders', () => {
    const now = D('2026-09-20');
    const a = row({
      entryType: 'COLLECTION_RECEIVED',
      credit: 300,
      availableAt: D('2026-09-05'),
      allocated: 100,
    });
    const b = row({
      entryType: 'COLLECTION_RECEIVED',
      credit: 500,
      availableAt: D('2026-09-02'),
    });
    const c = row({
      entryType: 'COLLECTION_RECEIVED',
      credit: 700,
      availableAt: D('2026-09-30'),
    });
    const eligible = eligibleCredits([a, b, c], now, 'EGP');
    expect(eligible.map((e) => [e.id, e.remaining])).toEqual([
      [b.id, 500],
      [a.id, 200],
    ]);
    expect(allocateFifo(600, eligible)).toEqual([
      { ledgerEntryId: b.id, amount: 500 },
      { ledgerEntryId: a.id, amount: 100 },
    ]);
  });
});

describe('returns and commission reversal', () => {
  it('cumulative line returns add up exactly to the line amount', () => {
    const parts = [1, 1, 1].map((qty, i) => returnedLineAmount(100, 3, i, qty));
    expect(parts).toEqual([33.33, 33.34, 33.33]);
    expect(Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100).toBe(100);
  });

  it('commission reversal follows the returned share and never exceeds the commission', () => {
    const first = commissionReversalAmount({
      commission: 90,
      base: 900,
      returnedAfterEarningCumulative: 300,
      alreadyReversed: 0,
    });
    expect(first).toBe(30);
    const rest = commissionReversalAmount({
      commission: 90,
      base: 900,
      returnedAfterEarningCumulative: 1000,
      alreadyReversed: first,
    });
    expect(rest).toBe(60);
    expect(
      commissionReversalAmount({
        commission: 90,
        base: 900,
        returnedAfterEarningCumulative: 900,
        alreadyReversed: 90,
      }),
    ).toBe(0);
  });
});

describe('allocateSettlementFee', () => {
  it('splits the fee pro-rata with the exact total (largest remainder)', () => {
    const shares = allocateSettlementFee(10, [
      { key: 'a', amount: 100 },
      { key: 'b', amount: 100 },
      { key: 'c', amount: 100 },
    ]);
    const values = ['a', 'b', 'c'].map((k) => shares.get(k)!);
    expect(values).toEqual([3.34, 3.33, 3.33]);
    expect(Math.round(values.reduce((s, v) => s + v, 0) * 100)).toBe(1000);
  });
  it('zero fee ⇒ zero shares', () => {
    expect(allocateSettlementFee(0, [{ key: 'a', amount: 5 }]).get('a')).toBe(
      0,
    );
  });
});

describe('statement helpers', () => {
  it('running balance ends at opening + Σ credits − Σ debits; memo lines flagged', () => {
    const lines = [
      {
        entryType: 'COLLECTION_RECEIVED' as const,
        debit: 0,
        credit: 1100,
        memoAmount: null,
      },
      {
        entryType: 'COLLECTION_BY_AGENT' as const,
        debit: 0,
        credit: 0,
        memoAmount: 300,
      },
      {
        entryType: 'COMMISSION' as const,
        debit: 100,
        credit: 0,
        memoAmount: null,
      },
    ];
    const result = withRunningBalance(50, lines);
    expect(result.lines.map((l) => l.balance)).toEqual([1150, 1150, 1050]);
    expect(result.lines.map((l) => l.memo)).toEqual([false, true, false]);
    expect(result.closing).toBe(1050);
    const byType = sumByType(lines);
    expect(byType.COLLECTION_BY_AGENT.memo).toBe(300);
    expect(byType.COMMISSION.debit).toBe(100);
  });
});
