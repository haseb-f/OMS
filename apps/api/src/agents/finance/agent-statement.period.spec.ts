import { periodBounds } from './agent-statement.service';

describe('agent statement period (Africa/Cairo business days)', () => {
  const inside = (date: Date, from: string, to: string) => {
    const { start, end } = periodBounds(from, to);
    return date >= start! && date <= end!;
  };

  it('a Cairo evening after UTC midnight belongs to the next Cairo day', () => {
    // 2026-09-29 22:30 UTC = 2026-09-30 01:30 in Cairo.
    const lateEvening = new Date('2026-09-29T22:30:00.000Z');
    expect(inside(lateEvening, '2026-09-30', '2026-09-30')).toBe(true);
    expect(inside(lateEvening, '2026-09-29', '2026-09-29')).toBe(false);
  });

  it('date-only values stored at 00:00Z keep their date', () => {
    const journalDate = new Date('2026-09-29T00:00:00.000Z');
    expect(inside(journalDate, '2026-09-29', '2026-09-29')).toBe(true);
    expect(inside(journalDate, '2026-09-28', '2026-09-28')).toBe(false);
  });

  it('open bounds stay open', () => {
    expect(periodBounds()).toEqual({ start: null, end: null });
  });
});
