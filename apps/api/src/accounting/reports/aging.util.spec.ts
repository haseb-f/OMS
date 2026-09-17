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
});
