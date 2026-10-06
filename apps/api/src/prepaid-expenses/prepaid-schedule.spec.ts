import { prepaidPeriods } from './prepaid-expenses.service';

describe('prepaidPeriods — end date derived from start + periods', () => {
  it('derives the end date as the last day of the final period', () => {
    const schedule = prepaidPeriods(1000, 3, '2026-01-15');
    expect(schedule.periods).toHaveLength(3);
    expect(schedule.endDate.toISOString().slice(0, 10)).toBe('2026-04-14');
    const total = schedule.periods.reduce((sum, p) => sum + p.amount, 0);
    expect(Math.round(total * 100) / 100).toBe(1000);
    expect(schedule.periods[2].amount).toBe(333.34);
  });

  it('accepts a matching end date and rejects an inconsistent one', () => {
    expect(() =>
      prepaidPeriods(600, 6, '2026-01-01', '2026-06-30'),
    ).not.toThrow();
    expect(() => prepaidPeriods(600, 6, '2026-01-01', '2026-12-31')).toThrow(
      /End date must be 2026-06-30/,
    );
  });
});
