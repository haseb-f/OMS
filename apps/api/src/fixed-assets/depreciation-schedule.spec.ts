import {
  buildStraightLineSchedule,
  respreadRemainingAmounts,
} from './depreciation-schedule';

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

describe('respreadRemainingAmounts (R13b cost addition — change in estimate)', () => {
  const start = new Date(Date.UTC(2026, 8, 1));

  it('spreads the new book value less salvage over the remaining periods', () => {
    // cost 1,200 + 400 added, 800 already depreciated → 800 over 4 periods
    expect(respreadRemainingAmounts('STRAIGHT_LINE', 800, 0, 4, start)).toEqual(
      [200, 200, 200, 200],
    );
  });

  it('keeps salvage and lets the last period absorb rounding', () => {
    const amounts = respreadRemainingAmounts(
      'STRAIGHT_LINE',
      1000,
      100,
      7,
      start,
    );
    expect(amounts).toHaveLength(7);
    expect(Math.round(amounts.reduce((a, b) => a + b, 0) * 100)).toBe(90000);
    expect(amounts.slice(0, 6).every((a) => a === 128.57)).toBe(true);
    expect(amounts[6]).toBe(128.58);
  });

  it('declining balance reaches exactly the salvage value', () => {
    const amounts = respreadRemainingAmounts(
      'DECLINING_BALANCE',
      1000,
      50,
      5,
      start,
    );
    expect(Math.round(amounts.reduce((a, b) => a + b, 0) * 100)).toBe(95000);
  });

  it('returns zeros when nothing is left to depreciate and nothing for no periods', () => {
    expect(
      respreadRemainingAmounts('STRAIGHT_LINE', 100, 100, 3, start),
    ).toEqual([0, 0, 0]);
    expect(respreadRemainingAmounts('STRAIGHT_LINE', 100, 0, 0, start)).toEqual(
      [],
    );
  });
});
