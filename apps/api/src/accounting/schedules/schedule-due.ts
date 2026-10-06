import {
  toBusinessDateString,
  todayBusinessDate,
} from '../../common/time/business-date';

/**
 * Which schedule rows (depreciation periods, prepaid recognitions) are due.
 *
 * A row is due when its `periodEnd` is on or before `asOf` — the caller's
 * date, or TODAY IN AFRICA/CAIRO (never the server's UTC day: the 01:00 UTC
 * cron already runs on the Cairo date). `periodEnd` is a date-only column
 * whose value is the business date itself (business-date.ts), so the bound
 * is that calendar date (`lte`) — Prisma compares date columns by date, and
 * a timestamp bound would be truncated.
 */
export function dueThrough(asOf?: string): {
  asOfDate: string;
  periodEnd: { lte: Date };
} {
  const asOfDate = asOf ? toBusinessDateString(asOf) : todayBusinessDate();
  return { asOfDate, periodEnd: { lte: dateOnly(asOfDate) } };
}

/** Date-only value ("YYYY-MM-DD") as the 00:00Z instant date columns use. */
export function dateOnly(date: string): Date {
  return new Date(`${toBusinessDateString(date)}T00:00:00.000Z`);
}

/** "YYYY-MM-DD" of a date-only column value. */
export function dateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}
