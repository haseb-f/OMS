import { agingBucket, daysOutstanding } from './aging.util';

describe('aging.util', () => {
  it('buckets 0-30 / 31-60 / 61-90 / 90+', () => {
    expect(agingBucket(0)).toBe('current');
    expect(agingBucket(30)).toBe('current');
    expect(agingBucket(31)).toBe('days31to60');
    expect(agingBucket(60)).toBe('days31to60');
    expect(agingBucket(61)).toBe('days61to90');
    expect(agingBucket(90)).toBe('days61to90');
    expect(agingBucket(91)).toBe('over90');
  });

  it('never reports negative days outstanding', () => {
    const asOf = new Date('2026-01-01T00:00:00Z');
    const future = new Date('2026-01-10T00:00:00Z');
    expect(daysOutstanding(asOf, future)).toBe(0);
    expect(daysOutstanding(future, asOf)).toBe(9);
  });

  it('counts Africa/Cairo calendar days, not 24-hour blocks or UTC days', () => {
    // Confirmed 00:30 Cairo on 1 Oct (21:30Z on 30 Sep); as of end of 31 Oct (Cairo).
    const invoice = new Date('2026-09-30T21:30:00Z');
    expect(daysOutstanding(new Date('2026-10-31T21:59:59.999Z'), invoice)).toBe(
      30,
    );
    // Same Cairo day → 0, even though the UTC dates differ.
    expect(daysOutstanding(new Date('2026-10-01T20:00:00Z'), invoice)).toBe(0);
  });
});
