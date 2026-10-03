import { formatDate, fromISODate, getPresetRange, type DateRangePreset } from "@/lib/date";

/**
 * The business day of the OMS ERP is the calendar day in Africa/Cairo
 * (owner decision P9; the API applies the same rule in
 * apps/api/src/common/time/business-date.ts). Anything that turns "now" or a
 * posting instant into a calendar day for reporting — date-range presets,
 * report row dates, exports — goes through here, so every report, print and
 * export shares one business day whatever the viewer's browser zone is.
 *
 * Date-only values (stored as 00:00Z) keep their own date: Cairo is always
 * ahead of UTC by less than a day, so 00:00Z is 02:00/03:00 Cairo that day.
 */
export const BUSINESS_TIME_ZONE = "Africa/Cairo";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

let formatter: Intl.DateTimeFormat | null = null;

/** "YYYY-MM-DD" Cairo calendar date of an instant; a plain "YYYY-MM-DD" is returned as is. */
export function businessDateOf(value: Date | string | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string" && DATE_ONLY.test(value.trim())) return value.trim();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  formatter ??= new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** The one display format ("01 Oct 2026") of a posting's business date. */
export function formatBusinessDate(value: Date | string | null | undefined): string {
  const day = businessDateOf(value);
  return day ? formatDate(day) : "";
}

let clockFormatter: Intl.DateTimeFormat | null = null;

/**
 * An instant as Cairo wall-clock date + time — "01 Oct 2026 — 14:35" — e.g.
 * the "Printed at" stamp of every printout and export, so it reads the same
 * whatever the viewer's browser zone is.
 */
export function formatBusinessDateTime(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  clockFormatter ??= new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    clockFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${formatBusinessDate(date)} — ${parts.hour}:${parts.minute}`;
}

/**
 * Today's business (Cairo) date as a local calendar `Date` (local midnight of
 * that Y-M-D) — the shape date pickers and `toISODate` work with.
 */
export function businessToday(now: Date = new Date()): Date {
  return fromISODate(businessDateOf(now)) ?? now;
}

/** A quick-range preset ("Today", "This month" …) anchored on the Cairo business day. */
export function businessPresetRange(
  preset: DateRangePreset,
  now: Date = new Date(),
): { from: Date; to: Date } {
  return getPresetRange(preset, businessToday(now));
}
