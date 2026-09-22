import { Prisma } from '@prisma/client';
import {
  containsArabic,
  escapeLikePattern,
  normalizeArabicSearch,
  normalizedArabicColumnSql,
} from './arabic-search';

/** Same "select all matching, capped" bound the master-data lists use. */
export const ARABIC_SEARCH_ID_CAP = 10_000;

export interface ArabicNormalizedSearchTarget {
  /** Physical table name — a trusted, code-defined identifier (never user input). */
  table: string;
  /** Physical column names — trusted, code-defined identifiers (never user input). */
  columns: readonly string[];
}

type RawQueryClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * IDs of `target.table` rows whose `target.columns` match the
 * Arabic-normalized `search` text (see `arabic-search.ts`), or `null` when
 * the search has no Arabic in it (the plain `contains` search already
 * covers that case). The needle is always a bound parameter — only the
 * code-defined table/column identifiers are spliced into the SQL.
 *
 * Callers add `{ id: { in: ids } }` (or a FK `in`) as ONE MORE `OR` branch
 * next to their existing `contains` conditions, so every other filter,
 * permission scope, sort, and pagination rule stays in the Prisma `where`.
 */
export async function findArabicNormalizedIds(
  prisma: RawQueryClient,
  target: ArabicNormalizedSearchTarget,
  search: string | undefined | null,
  cap: number = ARABIC_SEARCH_ID_CAP,
): Promise<string[] | null> {
  if (!search || !target.columns.length || !containsArabic(search)) {
    return null;
  }
  const needle = normalizeArabicSearch(search);
  if (!needle) return null;
  const pattern = `%${escapeLikePattern(needle)}%`;
  const conditions = target.columns.map(
    (column) =>
      Prisma.sql`${normalizedArabicColumnSql(`"${column}"`)} LIKE ${pattern}`,
  );
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id::text AS id FROM ${Prisma.raw(`"${target.table}"`)} WHERE ${Prisma.join(conditions, ' OR ')} LIMIT ${cap}`,
  );
  return rows.map((row) => row.id);
}
