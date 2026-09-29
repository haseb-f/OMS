/**
 * Business-date rule for financial reports (owner decision, accounting
 * review P9 — specs/usability-financial-reports/decisions-round2.md §R2).
 *
 * The business operates in Egypt. A report day is a calendar day in the IANA
 * zone `Africa/Cairo` — including Egyptian DST — never a fixed "+2"/"+3"
 * and never the UTC day. Stored timestamps are not changed; only the query
 * boundaries are:
 *
 *   period [from, to]  → entryDate ≥ start(from)  AND  entryDate < start(to + 1 day)
 *   opening            → entryDate < start(from)
 *   as of `date`       → entryDate < start(date + 1 day)  (≤ that instant − 1 ms)
 *
 * where start(D) = the first UTC instant whose Africa/Cairo calendar date is D
 * (00:00 local; 01:00 local on the DST spring-forward day, when 00:00 does
 * not exist).
 *
 * Date-only values. Documents that carry only a date (fiscal-year bounds,
 * depreciation / prepaid periods, opening balances, receipts entered as a
 * date) are stored as 00:00:00.000Z of that date. Africa/Cairo is always
 * AHEAD of UTC by less than a day (UTC+2 / UTC+3), so 00:00Z of date D is
 * 02:00 / 03:00 in Cairo on the SAME date D. One rule therefore places both
 * kinds correctly — "business date = Africa/Cairo calendar date of the
 * stored instant":
 *
 *   2026-10-01T00:00:00Z (date-only 1 Oct)      → Cairo 1 Oct 03:00 → 1 Oct
 *   2026-09-30T21:30:00Z (00:30 Cairo on 1 Oct) → Cairo 1 Oct 00:30 → 1 Oct
 *
 * `business-date.spec.ts` asserts that invariant for every day of 2020–2035,
 * so a zone change that broke it (a zone behind UTC) fails the build.
 *
 * Implemented with the runtime's Intl time-zone data (ICU tzdata) — no date
 * library dependency.
 */

export const BUSINESS_TIME_ZONE = 'Africa/Cairo';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(instant: number, timeZone: string): LocalParts {
  const out: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Offset of `timeZone` from UTC at `instant`, in ms (Cairo: +2h or +3h). */
export function zoneOffsetMs(
  instant: number,
  timeZone: string = BUSINESS_TIME_ZONE,
): number {
  const whole = Math.floor(instant / 1000) * 1000;
  const p = localParts(whole, timeZone);
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - whole
  );
}

/** "YYYY-MM-DD" business (Africa/Cairo) calendar date of an instant. */
export function businessDateOf(
  instant: Date | number,
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  const time = typeof instant === 'number' ? instant : instant.getTime();
  const p = localParts(time, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * The calendar date a report parameter names. Accepts "YYYY-MM-DD" (what the
 * web sends) and, for compatibility, any ISO string starting with a date —
 * only its date part is used ("2026-10-01T00:00:00Z" → "2026-10-01").
 */
export function toBusinessDateString(value: string): string {
  const match = DATE_ONLY.exec(value.trim());
  if (!match) throw new RangeError(`Not a calendar date: "${value}"`);
  const [, y, m, d] = match;
  const probe = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (
    probe.getUTCFullYear() !== Number(y) ||
    probe.getUTCMonth() !== Number(m) - 1 ||
    probe.getUTCDate() !== Number(d)
  )
    throw new RangeError(`Not a calendar date: "${value}"`);
  return `${y}-${m}-${d}`;
}

/** Calendar arithmetic on "YYYY-MM-DD" (no time zone involved). */
export function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = toBusinessDateString(date).split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return `${pad(next.getUTCFullYear(), 4)}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** Whole calendar days from `from` to `to` ("YYYY-MM-DD"), negative when `to` is earlier. */
export function calendarDaysBetween(from: string, to: string): number {
  const utc = (date: string) => {
    const [y, m, d] = toBusinessDateString(date).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/**
 * First UTC instant of the business day `date` (00:00 Africa/Cairo, or the
 * first existing local time when a DST jump skips midnight).
 */
export function businessDayStart(
  date: string,
  timeZone: string = BUSINESS_TIME_ZONE,
): Date {
  const day = toBusinessDateString(date);
  const [y, m, d] = day.split('-').map(Number);
  const midnightUtc = Date.UTC(y, m - 1, d);
  // Two passes settle the offset in force at local midnight.
  let candidate = midnightUtc - zoneOffsetMs(midnightUtc, timeZone);
  candidate = midnightUtc - zoneOffsetMs(candidate, timeZone);
  const isStart = (t: number) =>
    businessDateOf(t, timeZone) === day &&
    businessDateOf(t - 1, timeZone) < day;
  if (isStart(candidate)) return new Date(candidate);
  // Midnight fell in a DST gap (or an unusual zone): the local date is
  // monotonic in the instant, so binary-search the first instant of `day`.
  let lo = midnightUtc - 2 * DAY_MS;
  let hi = midnightUtc + 2 * DAY_MS;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (businessDateOf(mid, timeZone) >= day) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

/** First instant of the business day after `date` — the exclusive end of `date`. */
export function businessDayEndExclusive(
  date: string,
  timeZone: string = BUSINESS_TIME_ZONE,
): Date {
  return businessDayStart(addCalendarDays(date, 1), timeZone);
}

/** Last millisecond of the business day `date` — an inclusive "as of" instant. */
export function endOfBusinessDay(
  date: string,
  timeZone: string = BUSINESS_TIME_ZONE,
): Date {
  return new Date(businessDayEndExclusive(date, timeZone).getTime() - 1);
}

/** A Prisma-compatible DateTime filter. */
export interface BusinessDateTimeFilter {
  gte?: Date;
  lt?: Date;
}

/**
 * Inclusive business-day range [dateFrom, dateTo] as UTC query bounds:
 * `gte` start of `dateFrom`, `lt` start of the day after `dateTo`. Either
 * bound is optional.
 */
export function businessDateRangeFilter(
  dateFrom?: string,
  dateTo?: string,
  timeZone: string = BUSINESS_TIME_ZONE,
): BusinessDateTimeFilter {
  const filter: BusinessDateTimeFilter = {};
  if (dateFrom) filter.gte = businessDayStart(dateFrom, timeZone);
  if (dateTo) filter.lt = businessDayEndExclusive(dateTo, timeZone);
  return filter;
}

/** Everything strictly before the business day `dateFrom` (an opening balance). */
export function beforeBusinessDay(
  dateFrom: string,
  timeZone: string = BUSINESS_TIME_ZONE,
): { lt: Date } {
  return { lt: businessDayStart(dateFrom, timeZone) };
}

/** Today's business date ("YYYY-MM-DD" in Africa/Cairo). */
export function todayBusinessDate(
  now: Date = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  return businessDateOf(now, timeZone);
}
