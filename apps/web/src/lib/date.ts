/**
 * The ONE date system for the OMS ERP. Every module displays and parses
 * dates through these functions — never a raw `toLocaleDateString()` /
 * `toLocaleString()` call, which is locale-dependent and would mix formats.
 *
 * Display format is fixed and locale-independent: `DD MMM YYYY` with
 * English abbreviated month names, always — even when the app UI is in
 * Arabic. Financial/document dates need to stay internationally
 * unambiguous, so the month name is never translated.
 */
export const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export const WEEKDAY_ABBR = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

/** Accepts both the canonical spaced form and the legacy hyphenated form. */
const DATE_PATTERN = /^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  // Date-only calendar day — never UTC-shift across timezones.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }
    return date;
  }

  // Midnight-UTC timestamps that represent a date-only business field.
  const midnightUtc = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(\.\d+)?Z$/i.exec(trimmed);
  if (midnightUtc) {
    const year = Number(midnightUtc[1]);
    const month = Number(midnightUtc[2]);
    const day = Number(midnightUtc[3]);
    return new Date(year, month - 1, day);
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** The one display format: "05 Sep 2026". Returns "" for null/invalid input. */
export function formatDate(value: Date | string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return `${pad2(date.getDate())} ${MONTH_ABBR[date.getMonth()]} ${date.getFullYear()}`;
}

/** Canonical alias — prefer this name in new call sites. */
export const formatDisplayDate = formatDate;

/** 24-hour clock: "14:35". Returns "" for null/invalid input. */
export function formatTime(value: Date | string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * True when the value carries a real clock time. Date-only strings
 * (`YYYY-MM-DD`) and midnight-UTC timestamps are treated as date-only so
 * the UI never fabricates a local 03:00 AM from a date field.
 */
export function hasClockTime(value: Date | string | null | undefined): boolean {
  if (value == null) return false;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
    if (/T00:00:00(\.\d+)?Z?$/i.test(trimmed)) return false;
  }
  const date = toDate(value);
  if (!date) return false;
  return date.getHours() !== 0 || date.getMinutes() !== 0 || date.getSeconds() !== 0;
}

/** Date + time: "05 Sep 2026 — 14:35". */
export function formatDateTime(value: Date | string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return `${formatDate(date)} — ${formatTime(date)}`;
}

/** Canonical alias — prefer this name in new call sites. */
export const formatDisplayDateTime = formatDateTime;

/** "05 Sep 2026 – 31 Sep 2026", or a single formatted date when both ends match. */
export function formatDateRange(
  from: Date | string | null | undefined,
  to: Date | string | null | undefined,
): string {
  const fromLabel = formatDate(from);
  const toLabel = formatDate(to);
  if (!fromLabel && !toLabel) return "";
  if (fromLabel === toLabel) return fromLabel;
  if (!fromLabel) return toLabel;
  if (!toLabel) return fromLabel;
  return `${fromLabel} – ${toLabel}`;
}

/**
 * Strictly parses "DD MMM YYYY" (canonical) or legacy "DD-MMM-YYYY".
 * Returns null on anything else, including a calendar-invalid date like 31 Feb 2026.
 */
export function parseDate(input: string): Date | null {
  const match = DATE_PATTERN.exec(input.trim());
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const monthIndex = MONTH_ABBR.findIndex((abbr) => abbr.toLowerCase() === monthText.toLowerCase());
  if (monthIndex === -1) return null;
  const day = Number(dayText);
  const year = Number(yearText);
  const date = new Date(year, monthIndex, day);
  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
    return null;
  }
  return date;
}

/** Empty string is treated as "not yet entered" — valid, not an error. */
export function isValidDateInput(input: string): boolean {
  return input.trim() === "" || parseDate(input) !== null;
}

/** For sending a date-only value to the API — "2026-01-01". */
export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function isSameDay(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

/** Compact Date Picker (UI redesign task) — order is the exact order the quick-range list renders in. */
export const DATE_RANGE_PRESETS = [
  "TODAY",
  "YESTERDAY",
  "LAST_7_DAYS",
  "LAST_30_DAYS",
  "THIS_MONTH",
  "LAST_MONTH",
  "THIS_YEAR",
] as const;

export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

/** Report filter presets (Date System task). "This X" presets run from the period start through today — the period hasn't ended yet. */
export function getPresetRange(
  preset: DateRangePreset,
  now: Date = new Date(),
): { from: Date; to: Date } {
  const today = startOfDay(now);
  switch (preset) {
    case "TODAY":
      return { from: today, to: today };
    case "YESTERDAY": {
      const yesterday = addDays(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case "LAST_7_DAYS":
      return { from: addDays(today, -6), to: today };
    case "LAST_30_DAYS":
      return { from: addDays(today, -29), to: today };
    case "THIS_MONTH":
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: today };
    case "LAST_MONTH": {
      const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const to = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from, to };
    }
    case "THIS_YEAR":
      return { from: new Date(today.getFullYear(), 0, 1), to: today };
  }
}
