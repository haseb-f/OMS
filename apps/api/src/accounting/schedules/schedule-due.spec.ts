import { dueThrough } from './schedule-due';

describe('dueThrough — schedule rows due by the Africa/Cairo business date', () => {
  afterEach(() => jest.useRealTimers());

  it('uses the Cairo date, not the UTC date, when no asOf is given', () => {
    jest.useFakeTimers();
    // 22:30 UTC on 31 Oct = 00:30 on 1 Nov in Cairo (UTC+2).
    jest.setSystemTime(new Date('2026-10-31T22:30:00Z'));
    const due = dueThrough();
    expect(due.asOfDate).toBe('2026-11-01');
    expect(due.periodEnd.lte.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('a period ending today is due; one ending tomorrow is not', () => {
    const due = dueThrough('2026-10-31');
    const periodEndToday = new Date('2026-10-31T00:00:00Z');
    const periodEndTomorrow = new Date('2026-11-01T00:00:00Z');
    expect(periodEndToday <= due.periodEnd.lte).toBe(true);
    expect(periodEndTomorrow <= due.periodEnd.lte).toBe(false);
  });

  it('accepts an ISO timestamp and keeps only its date part', () => {
    expect(dueThrough('2026-03-31T18:00:00.000Z').asOfDate).toBe('2026-03-31');
  });
});
