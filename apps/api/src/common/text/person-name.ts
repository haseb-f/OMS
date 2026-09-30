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
 * - hamza carriers ؤ → و and ئ → ي, a standalone ء is dropped;
 * - every whitespace character is removed ("عبد الله" = "عبدالله").
 *
 * `personNameKeySql()` encodes exactly the same mapping for a stored column,
 * so both sides of an equality comparison can never drift.
 */
const HAMZA_FROM = 'ؤئء';
const HAMZA_TO = 'وي';

export function personNameKey(value: string | null | undefined): string {
  if (!value) return '';
  return normalizeArabicSearch(value)
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ء/g, '')
    .replace(/\s+/g, '');
}

/**
 * SQL twin of `personNameKey()` for a trusted, code-defined column
 * identifier (never user input). Postgres `translate()` drops the FROM
 * characters without a TO counterpart, which is how the standalone hamza is
 * removed.
 */
export function personNameKeySql(column: string): Prisma.Sql {
  return Prisma.sql`regexp_replace(translate(${normalizedArabicColumnSql(column)}, ${HAMZA_FROM}, ${HAMZA_TO}), ${'\\s+'}, '', 'g')`;
}
