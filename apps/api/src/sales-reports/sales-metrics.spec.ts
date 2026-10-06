import { addCalendarDays } from '../common/time/business-date';
import {
  SalesTally,
  fulfillmentCodeOf,
  livePeriodRanges,
  periodRange,
  rangeDays,
  rankEntries,
  defaultPerformanceRange,
} from './sales-metrics';

const HOUR = 3_600_000;

function spans(now: string) {
  return Object.fromEntries(
    livePeriodRanges(new Date(now)).map((range) => [
      range.period,
      [range.from, range.to],
    ]),
  );
}

describe('sales-metrics periods (Africa/Cairo)', () => {
  it('00:30 Cairo is already the next business day (UTC is still the previous day)', () => {
    // 2026-10-05T21:30Z = 2026-10-06 00:30 Cairo (UTC+3, summer time).
    expect(spans('2026-10-05T21:30:00Z')).toEqual({
      today: ['2026-10-06', '2026-10-06'],
      yesterday: ['2026-10-05', '2026-10-05'],
      last7Days: ['2026-09-30', '2026-10-06'],
      thisMonth: ['2026-10-01', '2026-10-06'],
      lastMonth: ['2026-09-01', '2026-09-30'],
    });
  });

  it('23:30 Cairo stays on the same business day', () => {
    // 2026-10-05T20:30Z = 2026-10-05 23:30 Cairo.
    expect(spans('2026-10-05T20:30:00Z').today).toEqual([
      '2026-10-05',
      '2026-10-05',
    ]);
  });

  it('Last 7 days = today and the 6 previous days; last month across a year end', () => {
    // 2026-01-01T00:00Z = 02:00 Cairo on 1 Jan (UTC+2, winter).
    const s = spans('2026-01-01T00:00:00Z');
    expect(s.last7Days).toEqual(['2025-12-26', '2026-01-01']);
    expect(rangeDays(s.last7Days[0], s.last7Days[1])).toBe(7);
    expect(s.thisMonth).toEqual(['2026-01-01', '2026-01-01']);
    expect(s.lastMonth).toEqual(['2025-12-01', '2025-12-31']);
    expect(s.yesterday).toEqual(['2025-12-31', '2025-12-31']);
  });

  it('a business day starts at Cairo midnight (UTC+3 in summer, UTC+2 in winter)', () => {
    const summer = periodRange('2026-10-06', '2026-10-06');
    expect(summer.start.toISOString()).toBe('2026-10-05T21:00:00.000Z');
    expect(summer.endExclusive.toISOString()).toBe('2026-10-06T21:00:00.000Z');
    const winter = periodRange('2026-01-15', '2026-01-15');
    expect(winter.start.toISOString()).toBe('2026-01-14T22:00:00.000Z');
    expect(winter.endExclusive.getTime() - winter.start.getTime()).toBe(
      24 * HOUR,
    );
  });

  it('DST days keep contiguous bounds (one day is 23 h or 25 h, never a gap or overlap)', () => {
    const lengths = new Set<number>();
    for (const first of ['2026-04-18', '2026-10-24']) {
      for (let offset = 0; offset < 10; offset += 1) {
        const date = addCalendarDays(first, offset);
        const next = addCalendarDays(date, 1);
        const a = periodRange(date, date);
        const b = periodRange(next, next);
        expect(a.endExclusive.getTime()).toBe(b.start.getTime());
        const length = (a.endExclusive.getTime() - a.start.getTime()) / HOUR;
        expect([23, 24, 25]).toContain(length);
        lengths.add(length);
      }
    }
    // Egypt observes DST (spring-forward in April, fall-back in October).
    expect([...lengths].sort()).toEqual([23, 24, 25]);
  });

  it('default performance range is this month to date', () => {
    expect(defaultPerformanceRange(new Date('2026-10-05T21:30:00Z'))).toEqual({
      from: '2026-10-01',
      to: '2026-10-06',
    });
  });
});

describe('sales-metrics definitions', () => {
  it('maps legacy orders without a status definition from the shipping stage', () => {
    expect(fulfillmentCodeOf('DELIVERED', 'NOT_READY')).toBe('DELIVERED');
    expect(fulfillmentCodeOf(null, 'NOT_READY')).toBe('UNFULFILLED');
    expect(fulfillmentCodeOf(null, 'READY_FOR_SHIPPING')).toBe('READY');
  });

  it('cancelled is separate and never in an amount; returned stays a sale; currencies never mix', () => {
    const tally = new SalesTally()
      .add({
        statusCode: 'DELIVERED',
        currencyCode: 'EGP',
        count: 2,
        amount: '100.10',
      })
      .add({
        statusCode: 'RETURNED',
        currencyCode: 'EGP',
        count: 1,
        amount: '50.05',
      })
      .add({
        statusCode: 'CANCELLED',
        currencyCode: 'EGP',
        count: 3,
        amount: '999',
      })
      .add({
        statusCode: 'UNFULFILLED',
        currencyCode: 'SAR',
        count: 1,
        amount: 0.1,
      })
      .add({
        statusCode: 'UNFULFILLED',
        currencyCode: 'SAR',
        count: 1,
        amount: 0.2,
      });
    expect(tally.stats()).toEqual({
      orders: 8,
      valid: 5,
      cancelled: 3,
      returned: 1,
      amounts: [
        { currencyCode: 'EGP', amount: 150.15 },
        { currencyCode: 'SAR', amount: 0.3 },
      ],
    });
    expect(tally.statusBreakdown()).toEqual([
      { code: 'CANCELLED', count: 3 },
      { code: 'DELIVERED', count: 2 },
      { code: 'UNFULFILLED', count: 2 },
      { code: 'RETURNED', count: 1 },
    ]);
  });
});

describe('sales-metrics ranking', () => {
  const entry = (
    name: string,
    rows: Array<[string, string, number, number]>,
  ) => {
    const tally = new SalesTally();
    for (const [statusCode, currencyCode, count, amount] of rows) {
      tally.add({ statusCode, currencyCode, count, amount });
    }
    return { name, tally };
  };
  const a = entry('A', [['DELIVERED', 'EGP', 3, 300]]);
  const b = entry('B', [
    ['DELIVERED', 'SAR', 2, 5000],
    ['CANCELLED', 'EGP', 9, 9000],
  ]);
  const c = entry('C', [['DELIVERED', 'EGP', 2, 900]]);

  it('ranks by valid-order count by default (cancelled never counts)', () => {
    const ranked = rankEntries([b, c, a], 'count');
    expect(ranked.map((r) => [r.name, r.rank, r.rankValue])).toEqual([
      ['A', 1, 3],
      ['B', 2, 2],
      ['C', 2, 2],
    ]);
  });

  it('ranks by amount only within the chosen currency', () => {
    expect(
      rankEntries([a, b, c], 'amount', 'EGP').map((r) => [r.name, r.rankValue]),
    ).toEqual([
      ['C', 900],
      ['A', 300],
      ['B', 0],
    ]);
    expect(rankEntries([a, b, c], 'amount', 'SAR').map((r) => r.name)[0]).toBe(
      'B',
    );
    expect(() => rankEntries([a], 'amount')).toThrow(RangeError);
  });
});
