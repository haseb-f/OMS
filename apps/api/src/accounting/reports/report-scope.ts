import { JournalEntryStatus, Prisma } from '@prisma/client';
import {
  beforeBusinessDay,
  businessDateRangeFilter,
  endOfBusinessDay,
} from '../../common/time/business-date';
import type { ReportQueryBaseDto } from './dto/report-query-base.dto';
import { AGENT_RECOVERY_SOURCE_TYPES } from './statement-classification';

/**
 * The ONE entry filter every financial report uses (accounting review §7):
 *
 * - Status: POSTED + REVERSED by default; DRAFT only when `postedOnly` is
 *   explicitly false. A REVERSED original and its POSTED reversing entry are
 *   both included so they net to zero — excluding either would count the
 *   other alone.
 * - Soft-deleted entries are never included.
 * - Dates are BUSINESS days in Africa/Cairo (owner decision P9,
 *   common/time/business-date.ts), inclusive on both ends: start of the
 *   Cairo day `dateFrom` ≤ entryDate < start of the Cairo day after
 *   `dateTo` (DST-aware; date-only values stored at 00:00Z stay on their
 *   own date). "Opening" = everything strictly before the start of
 *   `dateFrom`; "as of" = everything up to the end of the `dateTo` day.
 * - Company / branch / cost center / project / transaction-currency scope
 *   filter the entry header; amounts are always the functional-currency
 *   figures stored on the lines.
 */
export const YEAR_CLOSING_SOURCE_TYPE = 'YEAR_CLOSING';
export const OPENING_BALANCE_SOURCE_TYPE = 'OPENING_BALANCE';

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
    entryDate: businessDateRangeFilter(filters.dateFrom, filters.dateTo),
  };
}

/** Entries strictly before `dateFrom` — the opening balance. Null without a `dateFrom`. */
export function openingScope(
  filters: ReportQueryBaseDto,
): Prisma.JournalEntryWhereInput | null {
  if (!filters.dateFrom) return null;
  return {
    ...reportEntryScope(filters),
    entryDate: beforeBusinessDay(filters.dateFrom),
  };
}

/** End of the `dateTo` business (Africa/Cairo) day, or now — the Balance Sheet / aging "as of". */
export function asOfEndOfDay(dateTo?: string): Date {
  return dateTo ? endOfBusinessDay(dateTo) : new Date();
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

/**
 * Narrow an entry scope to agent-recovery entries (AGENT_RECOVERY_SOURCE_TYPES)
 * and their reversals — a MANUAL reversal is judged by the entry it reverses.
 */
export function agentRecoveriesOf(
  where: Prisma.JournalEntryWhereInput,
): Prisma.JournalEntryWhereInput {
  const recovery: Prisma.JournalEntryWhereInput = {
    sourceType: { in: [...AGENT_RECOVERY_SOURCE_TYPES] },
  };
  const existing = where.AND
    ? Array.isArray(where.AND)
      ? where.AND
      : [where.AND]
    : [];
  return {
    ...where,
    AND: [
      ...existing,
      { OR: [recovery, { reversalOfEntry: { is: recovery } }] },
    ],
  };
}
