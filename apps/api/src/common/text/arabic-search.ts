import { Prisma } from '@prisma/client';

/**
 * Arabic search normalization — the ONE definition the API uses so a search
 * for "أحمد" finds "احمد", "السعوديه" finds "السعودية", "مصطفى" finds
 * "مصطفي", and "مُحَمَّد" finds "محمد". Applied to BOTH sides of a search:
 * `normalizeArabicSearch()` for the typed needle (JS) and
 * `normalizedArabicColumnSql()` for the stored column (Postgres), which
 * encode exactly the same mapping so they can never drift:
 *
 * - alef variants أ إ آ ٱ → ا
 * - taa marbuta ة → ه
 * - alef maqsura ى → ي
 * - tashkeel/diacritics (U+064B–U+0652, superscript alef U+0670) and
 *   tatweel ـ are removed
 * - Latin letters are lower-cased (the SQL side uses `lower()`)
 *
 * The web app mirrors this in `apps/web/src/lib/arabic-search.ts` for
 * client-side list filtering (the two apps share no runtime package).
 */
const FROM_CHARS = 'أإآٱةى';
const TO_CHARS = 'ااااهي';
// Tashkeel U+064B–U+0652, superscript alef U+0670, tatweel U+0640 (code
// points, not literals — combining marks are invisible in source).
const STRIPPED_CHARS = String.fromCharCode(
  0x064b,
  0x064c,
  0x064d,
  0x064e,
  0x064f,
  0x0650,
  0x0651,
  0x0652,
  0x0670,
  0x0640,
);

const REPLACEMENTS = new Map<string, string>(
  [...FROM_CHARS].map((char, index) => [char, TO_CHARS[index]]),
);
const REPLACE_PATTERN = new RegExp(`[${FROM_CHARS}]`, 'g');
const STRIP_PATTERN = new RegExp(`[${STRIPPED_CHARS}]`, 'g');
const ARABIC_LETTER_PATTERN = new RegExp(
  `[${String.fromCharCode(0x0600)}-${String.fromCharCode(0x06ff)}]`,
);

export function normalizeArabicSearch(value: string): string {
  return value
    .normalize('NFC')
    .replace(STRIP_PATTERN, '')
    .replace(REPLACE_PATTERN, (char) => REPLACEMENTS.get(char) ?? char)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the text contains any Arabic-block character — only then is the normalized (SQL) path worth running. */
export function containsArabic(value: string): boolean {
  return ARABIC_LETTER_PATTERN.test(value);
}

/**
 * `translate(lower(<column>), FROM, TO)` — Postgres drops every FROM char
 * without a TO counterpart, which is how tashkeel/tatweel get stripped.
 * `column` must be a trusted, code-defined SQL identifier (never user input).
 */
export function normalizedArabicColumnSql(column: string): Prisma.Sql {
  return Prisma.sql`translate(lower(${Prisma.raw(column)}), ${FROM_CHARS + STRIPPED_CHARS}, ${TO_CHARS})`;
}

/** Escapes LIKE wildcards so a user's `%`/`_` are matched literally. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
