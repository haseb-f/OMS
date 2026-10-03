/**
 * The ONE amount formatter for OMS — screen cells, report summaries, Excel
 * number formats, CSV and print all derive their text from here, so a figure
 * reads identically everywhere.
 *
 * Digits are always Latin (0–9) with `,` grouping and `.` decimals in BOTH
 * UI languages (a fixed `en-US` number format, never the browser/OS locale):
 * one digit system on screen and in print, and no server/client hydration
 * mismatch.
 */

/**
 * How a negative value is written:
 * - `minus`  — leading minus: `-1,234.50` (statements, balances — a credit
 *              balance of a debit-positive column reads `-1,234.50`; the
 *              Debit/Credit columns beside it already name the side).
 * - `parens` — accounting parentheses: `(1,234.50)`.
 */
export type NegativeStyle = "minus" | "parens";

/** How a genuine zero is written: `0.00`, a quiet dash, or nothing. */
export type ZeroStyle = "dash" | "zero" | "blank";

/**
 * How a MISSING value (null, undefined, "", NaN — not available / not
 * applicable) is written: a dash (default) or nothing. A missing value is
 * never shown as `0.00`.
 */
export type MissingStyle = "dash" | "blank";

export interface FormatAmountOptions {
  /** ISO code appended after the figure (`1,234.50 EGP`). */
  currency?: string | null;
  negative?: NegativeStyle;
  zero?: ZeroStyle;
  missing?: MissingStyle;
  /** Fraction digits (default 2). */
  decimals?: number;
}

export interface AmountParts {
  /** The digits run, including a minus or parentheses — render inside `num`. */
  figure: string;
  /** Currency code, when requested and the value is not blank/missing. */
  currency: string;
  isZero: boolean;
  isNegative: boolean;
  /** The value is not available (null / undefined / "" / not a number). */
  isMissing: boolean;
}

export const ZERO_DASH = "—";

const formatters = new Map<number, Intl.NumberFormat>();

function formatterFor(decimals: number): Intl.NumberFormat {
  let formatter = formatters.get(decimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    formatters.set(decimals, formatter);
  }
  return formatter;
}

/** Arithmetic coercion (null / NaN → 0). Display paths use {@link toDisplayNumber}. */
function toNumber(value: unknown): number {
  return toDisplayNumber(value) ?? 0;
}

/**
 * The display coercion: a finite number, or `null` when the value is not
 * available (null, undefined, blank string, not a number) — so a missing
 * figure is never written as a fake `0.00`.
 */
export function toDisplayNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

/** True when the value rounds to zero at the given precision (never prints `-0.00`). */
export function isZeroAmount(value: unknown, decimals = 2): boolean {
  return Math.abs(toNumber(value)) < 0.5 * 10 ** -decimals;
}

/**
 * The structured form of {@link formatAmount} — for cells that style the
 * figure (e.g. a red negative) while producing exactly the same text.
 */
export function formatAmountParts(
  value: number | string | null | undefined,
  options: FormatAmountOptions = {},
): AmountParts {
  const decimals = options.decimals ?? 2;
  const negativeStyle = options.negative ?? "minus";
  const zeroStyle = options.zero ?? "zero";
  const amount = toDisplayNumber(value);
  const code = options.currency?.trim() ?? "";

  if (amount === null) {
    return {
      figure: options.missing === "blank" ? "" : ZERO_DASH,
      currency: "",
      isZero: false,
      isNegative: false,
      isMissing: true,
    };
  }

  if (isZeroAmount(amount, decimals)) {
    const figure =
      zeroStyle === "dash"
        ? ZERO_DASH
        : zeroStyle === "blank"
          ? ""
          : formatterFor(decimals).format(0);
    return {
      figure,
      currency: zeroStyle === "zero" ? code : "",
      isZero: true,
      isNegative: false,
      isMissing: false,
    };
  }

  const negative = amount < 0;
  const absolute = formatterFor(decimals).format(Math.abs(amount));
  const figure = !negative
    ? absolute
    : negativeStyle === "parens"
      ? `(${absolute})`
      : `-${absolute}`;
  return { figure, currency: code, isZero: false, isNegative: negative, isMissing: false };
}

/** Joins the parts in reading order: figure, currency. */
export function joinAmountParts(parts: AmountParts): string {
  return [parts.figure, parts.currency].filter(Boolean).join(" ");
}

/**
 * Formats an amount with Latin digits, grouping and fixed decimals.
 *
 * @example formatAmount(-1234.5)                          // "-1,234.50"
 * @example formatAmount(-1234.5, { negative: "parens" })  // "(1,234.50)"
 * @example formatAmount(0)                                // "0.00"
 * @example formatAmount(null)                             // "—" (missing, never 0.00)
 */
export function formatAmount(
  value: number | string | null | undefined,
  options: FormatAmountOptions = {},
): string {
  return joinAmountParts(formatAmountParts(value, options));
}

/**
 * Money for general OMS display: `1,234.50` (+ ` CODE`), minus for
 * negatives, `0.00` for zero, "—" when the value is missing. A thin wrapper
 * over {@link formatAmount}.
 */
export function formatMoney(
  value: string | number | null | undefined,
  currencyCode?: string | null,
): string {
  return formatAmount(value, { currency: currencyCode, negative: "minus", zero: "zero" });
}

export function currencyCodeOf(currency: string | { code: string } | null | undefined): string {
  if (!currency) return "";
  return typeof currency === "string" ? currency : currency.code;
}
