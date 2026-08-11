/**
 * Configurable digit-width for an auto-generated child account code's own
 * suffix segment (Part 12) — e.g. width 2 under parent "111" proposes
 * "11101".."11199" before rolling over. A single constant, not inlined in
 * `ChartOfAccountsService`, so a future company-numbering-scheme setting
 * can override it without touching the generation logic itself.
 */
export const CODE_SUFFIX_DIGIT_WIDTH = 2;
