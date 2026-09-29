import {
  businessDateOf,
  businessDayEndExclusive,
  businessDayStart,
} from '../../common/time/business-date';

const DAY_MS = 86_400_000;

/**
 * Accounting Periods and Fiscal Years are CALENDAR-DATE ranges, and an
 * instant belongs to them by its BUSINESS date — the Africa/Cairo calendar
 * date (`common/time/business-date.ts`, decisions-round2.md §R2) — the
 * same day every financial report uses. So an entry at 00:30 Cairo on
 * 1 Oct (2026-09-30T21:30Z) is locked, closed and reported with October,
 * never with September.
 *
 * The stored bounds are instants that NAME a calendar date, in one of
 * three historical shapes:
 *   - date-only 00:00:00.000Z (DTO dates, the rule for date-only values);
 *   - server-local midnight (periods generated before this change — e.g.
 *     2026-09-30T21:00Z for 1 Oct on a UTC+3 server);
 *   - an end-of-day marker ending in :59:59.999 (e.g. the foundation's
 *     `Date.UTC(y, 11, 31, 23, 59, 59, 999)` year end).
 * `rangeDateOf` recovers the named date from any of them.
 */
export function rangeDateOf(stored: Date): string {
  const utcDate = (time: number) => new Date(time).toISOString().slice(0, 10);
  const time = stored.getTime();
  const isEndOfDayMarker =
    stored.getUTCMinutes() === 59 &&
    stored.getUTCSeconds() === 59 &&
    stored.getUTCMilliseconds() === 999;
  if (isEndOfDayMarker) return utcDate(time);
  // Local midnight of a zone ahead of UTC lands on the previous UTC
  // afternoon/evening; behind UTC, on the same UTC morning.
  return stored.getUTCHours() >= 12 ? utcDate(time + DAY_MS) : utcDate(time);
}

interface DateRange {
  startDate: Date;
  endDate: Date;
}

/** True when the instant's business date falls inside the range's calendar dates (both inclusive). */
export function coversInstant(range: DateRange, instant: Date): boolean {
  const day = businessDateOf(instant);
  return (
    rangeDateOf(range.startDate) <= day && day <= rangeDateOf(range.endDate)
  );
}

/**
 * Prisma `where`/`orderBy` pair for the ranges that may contain this
 * instant — slack of two days on the start so a range whose stored start
 * is later than the instant (date-only 1 Oct 00:00Z vs 00:30 Cairo =
 * 30 Sep 21:30Z) is still a candidate. Pick with `pickCovering`.
 */
export function candidateRangeQuery(instant: Date) {
  return {
    where: { startDate: { lte: new Date(instant.getTime() + 2 * DAY_MS) } },
    orderBy: { startDate: 'desc' as const },
    take: 4,
  };
}

/** The latest-starting candidate that covers the instant, or null. */
export function pickCovering<T extends DateRange>(
  candidates: T[],
  instant: Date,
): T | null {
  return candidates.find((range) => coversInstant(range, instant)) ?? null;
}

/** First instant of the range's first business day. */
export function rangeStart(range: { startDate: Date }): Date {
  return businessDayStart(rangeDateOf(range.startDate));
}

/** Exclusive upper bound for "dated within this range" queries: the start of the business day after its last day. */
export function exclusiveEnd(range: { endDate: Date }): Date {
  return businessDayEndExclusive(rangeDateOf(range.endDate));
}
