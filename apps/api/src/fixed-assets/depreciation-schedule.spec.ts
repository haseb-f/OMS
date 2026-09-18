import { buildStraightLineSchedule } from './depreciation-schedule';

describe('buildStraightLineSchedule', () => {
  it('allocates cost minus salvage across months with remainder on the last period', () => {
    const start = new Date(Date.UTC(2026, 0, 15));
    const periods = buildStraightLineSchedule(1000, 100, 3, start);
    expect(periods).toHaveLength(3);
    expect(periods.map((row) => row.amount)).toEqual([300, 300, 300]);
    expect(periods.reduce((sum, row) => sum + row.amount, 0)).toBe(900);
  });

  it('puts leftover cents on the final period', () => {
    const start = new Date(Date.UTC(2026, 8, 1));
    const periods = buildStraightLineSchedule(100, 0, 3, start);
    expect(periods.map((row) => row.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(periods.reduce((sum, row) => sum + row.amount, 0)).toBe(100);
  });
});
