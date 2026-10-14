/**
 * R22 — what a person types or pastes into an amount field, read as a number.
 *
 * Accepted: Latin digits, Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹)
 * digits, «.» or the Arabic decimal separator «٫» as the decimal point, and
 * grouping marks («,», «٬», «،», spaces) anywhere — `1,234.50`, `١٬٢٣٤٫٥`
 * and `1 234.5` all read 1234.5. Everything else is dropped. The canonical
 * text is plain Latin digits with one «.», e.g. "1234.50" — what every money
 * DTO and `Number()` expect. Pure functions: no locale, no rounding.
 */

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;
const DECIMAL_MARKS = new Set([".", "٫"]); // «.», «٫»
/** Grouping marks a pasted figure may carry: «,» «٬» «،» and the space family. */
const GROUPING = /[,٬،\s   ]/g;

function latinDigit(char: string): string | null {
  const code = char.charCodeAt(0);
  if (char >= "0" && char <= "9") return char;
  if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
    return String(code - ARABIC_INDIC_ZERO);
  }
  if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
    return String(code - EXTENDED_ARABIC_INDIC_ZERO);
  }
  return null;
}

export interface NumericTextOptions {
  /** Keep a leading minus (default false — amounts are positive). */
  allowNegative?: boolean;
}

/** The typed text with only the characters an amount can contain (the field keeps this while editing). */
export function sanitizeNumericText(raw: string, options: NumericTextOptions = {}): string {
  let out = "";
  for (const char of raw) {
    if (
      latinDigit(char) !== null ||
      DECIMAL_MARKS.has(char) ||
      /[,٬،    ]/.test(char) ||
      (options.allowNegative && char === "-" && out.trim() === "")
    ) {
      out += char;
    }
  }
  return out;
}

/** Canonical Latin text of the typed amount: "١٬٢٣٤٫٥٠" → "1234.50", "" when nothing numeric. */
export function normalizeNumericText(raw: string, options: NumericTextOptions = {}): string {
  const compact = String(raw ?? "").replace(GROUPING, "");
  let sign = "";
  let integer = "";
  let fraction: string | null = null;
  for (const char of compact) {
    const digit = latinDigit(char);
    if (digit !== null) {
      if (fraction === null) integer += digit;
      else fraction += digit;
    } else if (DECIMAL_MARKS.has(char)) {
      if (fraction === null) fraction = "";
    } else if (char === "-" && options.allowNegative && !integer && fraction === null) {
      sign = "-";
    }
  }
  if (!integer && fraction === null) return sign;
  return `${sign}${integer || "0"}${fraction === null ? "" : `.${fraction}`}`;
}

/** The typed amount as a number; null while it reads as nothing yet ("", ".", "-"). */
export function parseNumericText(raw: string, options: NumericTextOptions = {}): number | null {
  const canonical = normalizeNumericText(raw, options);
  if (!/\d/.test(canonical)) return null;
  const value = Number(canonical.endsWith(".") ? canonical.slice(0, -1) : canonical);
  return Number.isFinite(value) ? value : null;
}
