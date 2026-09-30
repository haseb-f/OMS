import { Prisma } from '@prisma/client';
import {
  normalizeArabicSearch,
  normalizedArabicColumnSql,
} from './arabic-search';

/**
 * Person-name comparison key (Round 5 Spec 1B — name-only duplicate
 * warning). Builds on the shared Arabic search normalization
 * (`arabic-search.ts`: alef forms أ إ آ ٱ → ا, ة → ه, ى → ي, tashkeel and
 * tatweel removed, Latin lower-cased) and additionally:
 *
 * - combining maddah / hamza above / hamza below (U+0653–U+0655) and the
 *   zero-width non-joiner (U+200C) are removed;
 * - Persian ی → ي and ک → ك;
 * - hamza carriers ؤ → و and ئ → ي, a standalone ء is dropped;
 * - every whitespace character is removed ("عبد الله" = "عبدالله").
 *
 * `personNameKeySql()` encodes the same mapping for a stored column: a
 * decomposed "و + hamza above" reaches و on both sides (JS composes it to ؤ
 * and maps the carrier; SQL strips the mark), so an equality comparison
 * never drifts.
 */
const EXTRA_FROM = 'ؤئیک';
const EXTRA_TO = 'وييك';
/** Dropped: standalone hamza, U+0653–U+0655, ZWNJ. */
const EXTRA_DROPPED = `ء${String.fromCharCode(0x0653, 0x0654, 0x0655, 0x200c)}`;

const EXTRA_MAP = new Map<string, string>(
  [...EXTRA_FROM].map((char, index) => [char, EXTRA_TO[index]]),
);
const EXTRA_MAP_PATTERN = new RegExp(`[${EXTRA_FROM}]`, 'g');
// Same set as EXTRA_DROPPED, as an alternation: a combining mark after a
// base letter inside one character class reads as a combined character.
const EXTRA_DROP_PATTERN = new RegExp([...EXTRA_DROPPED].join('|'), 'g');

export function personNameKey(value: string | null | undefined): string {
  if (!value) return '';
  return normalizeArabicSearch(value)
    .replace(EXTRA_DROP_PATTERN, '')
    .replace(EXTRA_MAP_PATTERN, (char) => EXTRA_MAP.get(char) ?? char)
    .replace(/\s+/g, '');
}

/**
 * SQL twin of `personNameKey()` for a trusted, code-defined column
 * identifier (never user input). Postgres `translate()` drops the FROM
 * characters without a TO counterpart.
 */
export function personNameKeySql(column: string): Prisma.Sql {
  return Prisma.sql`regexp_replace(translate(${normalizedArabicColumnSql(column)}, ${EXTRA_FROM + EXTRA_DROPPED}, ${EXTRA_TO}), ${'\\s+'}, '', 'g')`;
}
