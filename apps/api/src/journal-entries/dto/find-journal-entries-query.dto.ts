import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { JournalEntryStatus } from '@prisma/client';

/** `sortBy` values the list and `/ids` accept (JournalEntry scalar columns the UI sorts by). */
export const JOURNAL_ENTRY_SORTABLE_FIELDS = [
  'entryNumber',
  'entryDate',
  'description',
  'status',
  'totalDebit',
  'totalCredit',
  'referenceNumber',
  'postedAt',
  'createdAt',
  'updatedAt',
];
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';
import {
  TransformEnumList,
  IsOptionalUuidList,
} from '../../common/query/enum-list';

/** Mirrors FindFinancialTransactionsQueryDto's search/pagination shape. */
export class FindJournalEntriesQueryDto {
  @TransformEnumList()
  @IsEnum(JournalEntryStatus, { each: true })
  @IsOptional()
  status?: JournalEntryStatus[];

  /** TASK-053 — filter by which book of entry (Sales/Purchase/Cash/Bank/General Journal) the entry belongs to. */
  @IsOptionalUuidList()
  journalId?: string[];

  /** TASK-054 — Journal ↔ Source Document navigation: look up the entry a business document was auto-posted from (both required together). */
  @IsString()
  @IsOptional()
  sourceType?: string;

  @IsOptionalUuid()
  sourceId?: string;

  /** Matches Entry Number or Description (case-insensitive, partial). */
  @IsString()
  @IsOptional()
  search?: string;

  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  pageSize?: number = 20;

  /** Only real, sortable columns — anything else is a 400, never a Prisma 500. */
  @IsIn(JOURNAL_ENTRY_SORTABLE_FIELDS)
  @IsOptional()
  sortBy?: string;

  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
