/**
 * Bidirectional text helpers for mixed Arabic/Latin ERP surfaces.
 * Prefer column semantic types + SemanticValue/LocaleText over ad-hoc regex
 * at call sites — these helpers exist for auto-direction when the column
 * already knows the value is prose (names, countries, sources).
 */

const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** First strong directional character wins — Arabic → rtl, Latin/digit → ltr. */
export function detectTextDirection(value: string): "rtl" | "ltr" {
  for (const char of value) {
    if (ARABIC_SCRIPT.test(char)) return "rtl";
    if (/[A-Za-z0-9]/.test(char)) return "ltr";
  }
  return "ltr";
}

export function hasArabicScript(value: string): boolean {
  return ARABIC_SCRIPT.test(value);
}

/**
 * A left-to-right run (a date, "3 من 12"-style figures) inside text that can
 * only be a string — a card title, a joined caption, an interpolated message.
 * Wraps it in LEFT-TO-RIGHT ISOLATE … POP DIRECTIONAL ISOLATE so an Arabic
 * line never reorders "08 Oct 2026" into "Oct 2026 08". Display only — never
 * for exported or copied values; in JSX prefer `SemanticValue kind="date"`.
 */
export function ltrIsolate(text: string): string {
  return text ? `\u2066${text}\u2069` : text;
}
