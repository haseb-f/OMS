import { JournalEntryStatus, Prisma } from '@prisma/client';
import { buildDateRangeFilter } from '../../sales/shared/sales-list-query.util';
import type { ReportQueryBaseDto } from './dto/report-query-base.dto';

/**
 * The ONE entry filter every financial report uses (accounting review §7):
 *
 * - Status: POSTED + REVERSED by default; DRAFT only when `postedOnly` is
 *   explicitly false. A REVERSED original and its POSTED reversing entry are
 *   both included so they net to zero — excluding either would count the
 *   other alone.
 * - Soft-deleted entries are never included.
 * - Dates are calendar days in UTC, inclusive on both ends: `dateFrom`
 *   00:00:00.000Z ≤ entryDate ≤ `dateTo` 23:59:59.999Z (the posting-date
 *   semantics of `buildDateRangeFilter`, shared with every list/report).
 *   "Opening" = everything strictly before `dateFrom`; "as of" = everything
 *   up to the end of `dateTo`.
 * - Company / branch / cost center / project / transaction-currency scope
 *   filter the entry header; amounts are always the functional-currency
 *   figures stored on the lines.
 */
export const YEAR_CLOSING_SOURCE_TYPE = 'YEAR_CLOSING';
export const OPENING_BALANCE_SOURCE_TYPE = 'OPENING_BALANCE';

const END_OF_DAY_MS = 24 * 60 * 60 * 1000 - 1;

export function reportStatusFilter(
  postedOnly?: boolean,
): Prisma.EnumJournalEntryStatusFilter {
  if (postedOnly === false) {
    return {
      in: [
        JournalEntryStatus.DRAFT,
        JournalEntryStatus.POSTED,
        JournalEntryStatus.REVERSED,
      ],
    };
  }
  return { in: [JournalEntryStatus.POSTED, JournalEntryStatus.REVERSED] };
}

export function reportEntryScope(
  filters: ReportQueryBaseDto,
): Prisma.JournalEntryWhereInput {
  return {
    deletedAt: null,
    status: reportStatusFilter(filters.postedOnly),
    ...(filters.companyId && { companyId: filters.companyId }),
    ...(filters.branchId && { branchId: filters.branchId }),
    ...(filters.costCenterId && { costCenterId: filters.costCenterId }),
    ...(filters.projectId && { projectId: filters.projectId }),
    ...(filters.currencyId && { currencyId: filters.currencyId }),
  };
}

/** Entries inside [dateFrom, dateTo] (either bound optional). */
export function periodScope(
  filters: ReportQueryBaseDto,
): Prisma.JournalEntryWhereInput {
  return {
    ...reportEntryScope(filters),
    entryDate: buildDateRangeFilter(filters.dateFrom, filters.dateTo),
  };
}

/** Entries strictly before `dateFrom` — the opening balance. Null without a `dateFrom`. */
export function openingScope(
  filters: ReportQueryBaseDto,
): Prisma.JournalEntryWhereInput | null {
  if (!filters.dateFrom) return null;
  return {
    ...reportEntryScope(filters),
    entryDate: { lt: new Date(filters.dateFrom) },
  };
}

/** End of the `dateTo` UTC day (or now) — the Balance Sheet / aging "as of". */
export function asOfEndOfDay(dateTo?: string): Date {
  return dateTo
    ? new Date(new Date(dateTo).getTime() + END_OF_DAY_MS)
    : new Date();
}

/**
 * Income Statement scope: Year Closing entries only move P&L balances into
 * Retained Earnings — they are not income or expense of the year, so a
 * closed year's statement must still show its revenue and expenses.
 */
export function withoutYearClosing(
  where: Prisma.JournalEntryWhereInput,
): Prisma.JournalEntryWhereInput {
  const notClosing: Prisma.JournalEntryWhereInput = {
    OR: [
      { sourceType: null },
      { sourceType: { not: YEAR_CLOSING_SOURCE_TYPE } },
    ],
  };
  return {
    ...where,
    AND: [
      notClosing,
      // A Journal-Entries-screen reversal is stored as MANUAL: judge it by
      // the entry it reverses, so a reversed closing stays out as a pair.
      {
        OR: [
          { reversalOfEntryId: null },
          { reversalOfEntry: { is: notClosing } },
        ],
      },
    ],
  };
}

/**
 * One fiscal year's Year Closing entries and their reversals (the posting
 * engine keeps sourceType/sourceId on a reversal; the Journal Entries screen
 * stores it as MANUAL with `reversalOfEntryId`).
 */
export function yearClosingOf(
  fiscalYearId: string,
): Prisma.JournalEntryWhereInput {
  const closing: Prisma.JournalEntryWhereInput = {
    sourceType: YEAR_CLOSING_SOURCE_TYPE,
    sourceId: fiscalYearId,
  };
  return { OR: [closing, { reversalOfEntry: { is: closing } }] };
}

/**
 * Journal Report page order — a TOTAL order. Many entries share one
 * `entryDate` (date-only postings, batch imports), and ordering by date
 * alone lets PostgreSQL return ties in any order per page, so paging
 * (screen, print, export via fetchAllReportPages) repeated some entries and
 * skipped others. `entryNumber` is unique; `id` is the final tiebreak.
 */
export function journalReportOrder(
  sortOrder: 'asc' | 'desc',
): Prisma.JournalEntryOrderByWithRelationInput[] {
  return [
    { entryDate: sortOrder },
    { entryNumber: sortOrder },
    { id: sortOrder },
  ];
}

/** Lines inside one entry: `lineOrder`, then `id` (lineOrder is not unique). */
export const ENTRY_LINE_ORDER: Prisma.JournalEntryLineOrderByWithRelationInput[] =
  [{ lineOrder: 'asc' }, { id: 'asc' }];
