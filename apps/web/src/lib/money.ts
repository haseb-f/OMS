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
 * - `minus`  — leading minus: `-1,234.50` (statements: P&L, Balance Sheet, Cash Flow).
 * - `parens` — accounting parentheses: `(1,234.50)`.
 * - `drcr`   — debit-positive balances as an absolute value with a side
 *              suffix: `1,234.50 Dr` / `1,234.50 Cr` (Trial Balance, ledgers,
 *              statements) — a credit balance is a side, not an error.
 */
export type NegativeStyle = "minus" | "parens" | "drcr";

/** How a zero is written: a quiet dash, `0.00`, or nothing. */
export type ZeroStyle = "dash" | "zero" | "blank";

export interface FormatAmountOptions {
  /** ISO code appended after the figure (`1,234.50 EGP`). */
  currency?: string | null;
  negative?: NegativeStyle;
  zero?: ZeroStyle;
  /** Fraction digits (default 2). */
  decimals?: number;
  /** Localized side labels for `drcr` (default `Dr` / `Cr`). */
  drcrLabels?: { debit: string; credit: string };
}

export interface AmountParts {
  /** The digits run, including a minus or parentheses — render inside `num`. */
  figure: string;
  /** Dr/Cr side label (only for `drcr` and a non-zero value). */
  side: string;
  /** Currency code, when requested and the value is not blank. */
  currency: string;
  isZero: boolean;
  isNegative: boolean;
}

export const ZERO_DASH = "—";

const DEFAULT_DRCR = { debit: "Dr", credit: "Cr" };

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

function toNumber(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

/** True when the value rounds to zero at the given precision (never prints `-0.00`). */
export function isZeroAmount(value: unknown, decimals = 2): boolean {
  return Math.abs(toNumber(value)) < 0.5 * 10 ** -decimals;
}

/**
 * The structured form of {@link formatAmount} — for cells that lay out the
 * figure and its Dr/Cr side separately (so figures stay aligned) while
 * producing exactly the same text.
 */
export function formatAmountParts(
  value: number | string | null | undefined,
  options: FormatAmountOptions = {},
): AmountParts {
  const decimals = options.decimals ?? 2;
  const negativeStyle = options.negative ?? "minus";
  const zeroStyle = options.zero ?? "zero";
  const amount = toNumber(value);
  const code = options.currency?.trim() ?? "";

  if (isZeroAmount(amount, decimals)) {
    const figure =
      zeroStyle === "dash"
        ? ZERO_DASH
        : zeroStyle === "blank"
          ? ""
          : formatterFor(decimals).format(0);
    return {
      figure,
      side: "",
      currency: zeroStyle === "zero" ? code : "",
      isZero: true,
      isNegative: false,
    };
  }

  const negative = amount < 0;
  const absolute = formatterFor(decimals).format(Math.abs(amount));
  if (negativeStyle === "drcr") {
    const labels = options.drcrLabels ?? DEFAULT_DRCR;
    return {
      figure: absolute,
      side: negative ? labels.credit : labels.debit,
      currency: code,
      isZero: false,
      isNegative: negative,
    };
  }
  const figure = !negative
    ? absolute
    : negativeStyle === "parens"
      ? `(${absolute})`
      : `-${absolute}`;
  return { figure, side: "", currency: code, isZero: false, isNegative: negative };
}

/** Joins the parts in reading order: figure, side, currency. */
export function joinAmountParts(parts: AmountParts): string {
  return [parts.figure, parts.side, parts.currency].filter(Boolean).join(" ");
}

/**
 * Formats an amount with Latin digits, grouping and fixed decimals.
 *
 * @example formatAmount(-1234.5)                          // "-1,234.50"
 * @example formatAmount(-1234.5, { negative: "parens" })  // "(1,234.50)"
 * @example formatAmount(-1234.5, { negative: "drcr" })    // "1,234.50 Cr"
 * @example formatAmount(0, { zero: "dash" })              // "—"
 */
export function formatAmount(
  value: number | string | null | undefined,
  options: FormatAmountOptions = {},
): string {
  return joinAmountParts(formatAmountParts(value, options));
}

/**
 * Money for general OMS display: `1,234.50` (+ ` CODE`), minus for
 * negatives, `0.00` for zero. A thin wrapper over {@link formatAmount}.
 */
export function formatMoney(value: string | number, currencyCode?: string | null): string {
  return formatAmount(value, { currency: currencyCode, negative: "minus", zero: "zero" });
}

export function currencyCodeOf(currency: string | { code: string } | null | undefined): string {
  if (!currency) return "";
  return typeof currency === "string" ? currency : currency.code;
}
