import {
  allocatePaymentsOldestFirst,
  partnershipState,
  profitBaseLines,
} from './partner-statement-rules';

/** R15 (spec-w4 §4-5, D15-14, D15-15) — pure rules of the per-period statement. */
describe('partner statement rules', () => {
  describe('payments applied to closed periods oldest-first (D15-15)', () => {
    const periods = [
      { key: 'jan', due: 1_000 },
      { key: 'feb', due: 2_500.5 },
      { key: 'mar', due: 700 },
    ];

    it('fills the oldest period first, then the next', () => {
      const { byPeriod, unallocated } = allocatePaymentsOldestFirst(
        periods,
        1_800.25,
      );
      expect(Object.fromEntries(byPeriod)).toEqual({
        jan: { paid: 1_000, remaining: 0 },
        feb: { paid: 800.25, remaining: 1_700.25 },
        mar: { paid: 0, remaining: 700 },
      });
      expect(unallocated).toBe(0);
    });

    it('anything paid beyond every approved period is an advance', () => {
      const { byPeriod, unallocated } = allocatePaymentsOldestFirst(
        periods,
        4_500,
      );
      expect([...byPeriod.values()].every((p) => p.remaining === 0)).toBe(true);
      expect(unallocated).toBe(299.5);
    });

    it('nothing paid leaves every period fully remaining', () => {
      const { byPeriod } = allocatePaymentsOldestFirst(periods, 0);
      expect(byPeriod.get('feb')).toEqual({ paid: 0, remaining: 2_500.5 });
    });
  });

  describe('partnership expiry (4.7)', () => {
    const today = '2026-10-07';

    it('no agreement in force → no partnership', () => {
      expect(partnershipState([], today)).toEqual({
        status: 'NO_AGREEMENT',
        startedOn: null,
        endsOn: null,
      });
    });

    it('ended after the last agreement end date; the span is kept', () => {
      expect(
        partnershipState(
          [
            { effectiveFrom: '2025-01-01', effectiveTo: '2025-06-30' },
            { effectiveFrom: '2025-07-01', effectiveTo: '2026-03-15' },
          ],
          today,
        ),
      ).toEqual({
        status: 'ENDED',
        startedOn: '2025-01-01',
        endsOn: '2026-03-15',
      });
    });

    it('still active on its last day, and while any agreement is open-ended', () => {
      expect(
        partnershipState(
          [{ effectiveFrom: '2026-01-01', effectiveTo: today }],
          today,
        ).status,
      ).toBe('ACTIVE');
      expect(
        partnershipState(
          [
            { effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31' },
            { effectiveFrom: '2026-02-01', effectiveTo: null },
          ],
          today,
        ),
      ).toEqual({ status: 'ACTIVE', startedOn: '2025-01-01', endsOn: null });
    });

    it('not started before the first agreement begins', () => {
      expect(
        partnershipState(
          [{ effectiveFrom: '2026-11-01', effectiveTo: null }],
          today,
        ).status,
      ).toBe('NOT_STARTED');
    });
  });

  describe('company figures a partner may see (4.11)', () => {
    const figures = {
      netRevenue: 100_000,
      costOfSales: 55_000,
      grossProfit: 45_000,
      otherExpensesNet: 25_000,
      netProfit: 20_000,
    };

    it('gross basis: revenue, cost of sales, gross profit — no expense line', () => {
      expect(profitBaseLines(figures, 'GROSS_PROFIT')).toEqual({
        netRevenue: 100_000,
        costOfSales: 55_000,
        otherExpensesNet: null,
        profit: 45_000,
      });
    });

    it('net basis: plus the net of expenses, and net profit', () => {
      expect(profitBaseLines(figures, 'NET_PROFIT')).toEqual({
        netRevenue: 100_000,
        costOfSales: 55_000,
        otherExpensesNet: 25_000,
        profit: 20_000,
      });
    });
  });
});
