/**
 * Date-only helpers for FX. Rates, overrides and `asOf` are compared as
 * calendar dates (Postgres `DATE`, carried in JS as UTC midnight). A
 * document's `asOf` is reduced to its UTC calendar date — the same reduction
 * the posting engine already used (`asOf.toISOString().slice(0, 10)`).
 */

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' of a Date's UTC calendar day. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** UTC-midnight Date of the calendar day `date` falls on. */
export function dayStart(date: Date): Date {
  return new Date(`${isoDay(date)}T00:00:00.000Z`);
}

/** Strict 'YYYY-MM-DD' → UTC-midnight Date (throws on an invalid day). */
export function parseIsoDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date "${value}" (expected YYYY-MM-DD).`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || isoDay(date) !== value) {
    throw new Error(`Invalid calendar date "${value}".`);
  }
  return date;
}

/** Whole calendar days from `from` to `to` (both reduced to their UTC day). */
export function daysBetween(from: Date, to: Date): number {
  return Math.round(
    (dayStart(to).getTime() - dayStart(from).getTime()) / DAY_MS,
  );
}

export function addDays(date: Date, days: number): Date {
  return new Date(dayStart(date).getTime() + days * DAY_MS);
}

/** Today's calendar date in Cairo (CBE publication dates are Cairo dates; Egypt observes DST, so the IANA zone is used, never a fixed offset). */
export function cairoToday(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parseIsoDay(parts);
}

/** Clock-skew / time-zone slack for "not in the future" checks on business dates. */
export const FUTURE_DATE_TOLERANCE_MS = 2 * 60 * 60 * 1000;

/**
 * True when the calendar day of `date` is after today in Cairo (EGP base
 * currency, Egyptian business dates), allowing `toleranceMs` of clock skew.
 * Used to refuse future-dated settlements and statement transactions.
 */
export function isAfterCairoToday(
  date: Date,
  now: Date = new Date(),
  toleranceMs = FUTURE_DATE_TOLERANCE_MS,
): boolean {
  const latest = cairoToday(new Date(now.getTime() + toleranceMs));
  return dayStart(date).getTime() > latest.getTime();
}
