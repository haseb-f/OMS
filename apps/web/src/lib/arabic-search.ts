/**
 * Arabic search normalization for client-side list filtering — mirrors the
 * API's `apps/api/src/common/text/arabic-search.ts` (the two apps share no
 * runtime package), so a picker finds the same rows the server search does:
 * أ إ آ ٱ → ا, ة → ه, ى → ي, tashkeel/superscript alef/tatweel removed,
 * Latin lower-cased, whitespace collapsed.
 */
const REPLACEMENTS: Record<string, string> = {
  أ: "ا",
  إ: "ا",
  آ: "ا",
  ٱ: "ا",
  ة: "ه",
  ى: "ي",
};
const REPLACE_PATTERN = /[أإآٱةى]/g;
// Tashkeel U+064B–U+0652, superscript alef U+0670, tatweel U+0640 (code
// points, not literals — combining marks are invisible in source).
const STRIP_PATTERN = new RegExp(
  `[${String.fromCharCode(0x064b)}-${String.fromCharCode(0x0652)}${String.fromCharCode(0x0670, 0x0640)}]`,
  "g",
);

export function normalizeArabicSearch(value: string): string {
  return value
    .normalize("NFC")
    .replace(STRIP_PATTERN, "")
    .replace(REPLACE_PATTERN, (char) => REPLACEMENTS[char] ?? char)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
