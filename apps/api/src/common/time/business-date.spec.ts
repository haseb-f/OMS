import {
  addCalendarDays,
  beforeBusinessDay,
  BUSINESS_TIME_ZONE,
  businessDateOf,
  businessDateRangeFilter,
  businessDayEndExclusive,
  businessDayStart,
  calendarDaysBetween,
  endOfBusinessDay,
  toBusinessDateString,
  zoneOffsetMs,
} from './business-date';

const HOUR = 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString();

/** Instants where the Africa/Cairo offset changes in `year`, read from the runtime tz data. */
function cairoTransitions(year: number) {
  const out: Array<{ at: Date; from: number; to: number }> = [];
  let prev = zoneOffsetMs(Date.UTC(year, 0, 1));
  for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += HOUR) {
    const offset = zoneOffsetMs(t);
    if (offset !== prev) {
      // refine to the minute
      let lo = t - HOUR;
      let hi = t;
      while (hi - lo > 60_000) {
        const mid = lo + Math.floor((hi - lo) / 2 / 60_000) * 60_000;
        if (zoneOffsetMs(mid) === prev) lo = mid;
        else hi = mid;
      }
      out.push({ at: new Date(hi), from: prev / HOUR, to: offset / HOUR });
      prev = offset;
    }
  }
  return out;
}

/** Last given weekday (0 = Sunday … 6 = Saturday) of a month, as "YYYY-MM-DD". */
function lastWeekdayOf(year: number, monthIndex: number, weekday: number) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  const back = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(last.getTime() - back * 24 * HOUR).toISOString().slice(0, 10);
}

describe('business date (Africa/Cairo)', () => {
  it('uses the IANA zone, not a fixed offset', () => {
    expect(BUSINESS_TIME_ZONE).toBe('Africa/Cairo');
    expect(zoneOffsetMs(Date.UTC(2026, 0, 15))).toBe(2 * HOUR);
    expect(zoneOffsetMs(Date.UTC(2026, 6, 15))).toBe(3 * HOUR);
  });

  it('Egypt DST 2026 per runtime tz data: last Friday of April → last Thursday of October', () => {
    const transitions = cairoTransitions(2026);
    expect(transitions).toHaveLength(2);
    const [spring, autumn] = transitions;
    // Spring forward at 00:00 local (+2) of the last Friday of April.
    expect(spring.from).toBe(2);
    expect(spring.to).toBe(3);
    const lastFridayApril = lastWeekdayOf(2026, 3, 5);
    expect(lastFridayApril).toBe('2026-04-24');
    expect(iso(spring.at)).toBe(`2026-04-23T22:00:00.000Z`);
    expect(businessDateOf(spring.at)).toBe(lastFridayApril);
    // Fall back at 24:00 local (+3) at the end of the last Thursday of October.
    expect(autumn.from).toBe(3);
    expect(autumn.to).toBe(2);
    const lastThursdayOctober = lastWeekdayOf(2026, 9, 4);
    expect(lastThursdayOctober).toBe('2026-10-29');
    expect(iso(autumn.at)).toBe('2026-10-29T21:00:00.000Z');
    expect(businessDateOf(autumn.at.getTime() - 1)).toBe(lastThursdayOctober);
  });

  it('date-only values stored at 00:00Z keep their own date — every day 2020-2035', () => {
    for (
      let t = Date.UTC(2020, 0, 1);
      t < Date.UTC(2036, 0, 1);
      t += 24 * HOUR
    ) {
      const day = new Date(t).toISOString().slice(0, 10);
      expect(businessDateOf(t)).toBe(day);
    }
  });

  it('local midnight: 21:30Z on 30 Sep (00:30 Cairo, DST) is 1 Oct; 00:00Z 1 Oct is also 1 Oct', () => {
    expect(businessDateOf(new Date('2026-09-30T21:30:00Z'))).toBe('2026-10-01');
    expect(businessDateOf(new Date('2026-10-01T00:00:00Z'))).toBe('2026-10-01');
    expect(businessDateOf(new Date('2026-09-30T20:59:59.999Z'))).toBe(
      '2026-09-30',
    );
    expect(iso(businessDayStart('2026-10-01'))).toBe(
      '2026-09-30T21:00:00.000Z',
    );
  });

  it('winter midnight and year end: 31 Dec → 1 Jan at 22:00Z (UTC+2)', () => {
    expect(iso(businessDayStart('2027-01-01'))).toBe(
      '2026-12-31T22:00:00.000Z',
    );
    expect(businessDateOf(new Date('2026-12-31T21:59:59.999Z'))).toBe(
      '2026-12-31',
    );
    expect(businessDateOf(new Date('2026-12-31T22:00:00Z'))).toBe('2027-01-01');
    expect(businessDateRangeFilter('2026-01-01', '2026-12-31')).toEqual({
      gte: new Date('2025-12-31T22:00:00.000Z'),
      lt: new Date('2026-12-31T22:00:00.000Z'),
    });
  });

  it('DST days: 24 Apr starts at 22:00Z (00:00 does not exist); 29 Oct is 25 hours long', () => {
    // 23 Apr is still UTC+2: 00:00 local = 22:00Z the day before.
    expect(iso(businessDayStart('2026-04-23'))).toBe(
      '2026-04-22T22:00:00.000Z',
    );
    // 24 Apr: clocks jump 00:00 → 01:00; the day starts at 22:00Z on the 23rd.
    expect(iso(businessDayStart('2026-04-24'))).toBe(
      '2026-04-23T22:00:00.000Z',
    );
    expect(iso(businessDayStart('2026-04-25'))).toBe(
      '2026-04-24T21:00:00.000Z',
    );
    // 24 Apr is 23 hours long.
    expect(
      businessDayEndExclusive('2026-04-24').getTime() -
        businessDayStart('2026-04-24').getTime(),
    ).toBe(23 * HOUR);
    // 29 Oct (UTC+3) starts 21:00Z on the 28th; 30 Oct (UTC+2) at 22:00Z on the 29th.
    expect(iso(businessDayStart('2026-10-29'))).toBe(
      '2026-10-28T21:00:00.000Z',
    );
    expect(iso(businessDayStart('2026-10-30'))).toBe(
      '2026-10-29T22:00:00.000Z',
    );
    expect(
      businessDayEndExclusive('2026-10-29').getTime() -
        businessDayStart('2026-10-29').getTime(),
    ).toBe(25 * HOUR);
    // 23:30 local in the repeated hour (+2, after fall-back) is still 29 Oct.
    expect(businessDateOf(new Date('2026-10-29T21:30:00Z'))).toBe('2026-10-29');
  });

  it('month-end range, opening and as-of bounds', () => {
    expect(businessDateRangeFilter('2026-09-01', '2026-09-30')).toEqual({
      gte: new Date('2026-08-31T21:00:00.000Z'),
      lt: new Date('2026-09-30T21:00:00.000Z'),
    });
    expect(beforeBusinessDay('2026-10-01')).toEqual({
      lt: new Date('2026-09-30T21:00:00.000Z'),
    });
    expect(iso(endOfBusinessDay('2026-09-30'))).toBe(
      '2026-09-30T20:59:59.999Z',
    );
    expect(businessDateRangeFilter()).toEqual({});
    expect(businessDateRangeFilter(undefined, '2026-09-30')).toEqual({
      lt: new Date('2026-09-30T21:00:00.000Z'),
    });
  });

  it('parses only the calendar date of a parameter and validates it', () => {
    expect(toBusinessDateString('2026-10-01')).toBe('2026-10-01');
    expect(toBusinessDateString('2026-10-01T00:00:00.000Z')).toBe('2026-10-01');
    expect(() => toBusinessDateString('2026-02-30')).toThrow(RangeError);
    expect(() => toBusinessDateString('Oct 1')).toThrow(RangeError);
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addCalendarDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(calendarDaysBetween('2026-09-30', '2026-10-01')).toBe(1);
    expect(calendarDaysBetween('2026-10-29', '2026-10-30')).toBe(1);
  });
});
