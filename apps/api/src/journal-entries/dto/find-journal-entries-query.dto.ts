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
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Mirrors FindFinancialTransactionsQueryDto's search/pagination shape. */
export class FindJournalEntriesQueryDto {
  @IsEnum(JournalEntryStatus)
  @IsOptional()
  status?: JournalEntryStatus;

  /** TASK-053 — filter by which book of entry (Sales/Purchase/Cash/Bank/General Journal) the entry belongs to. */
  @IsOptionalUuid()
  journalId?: string;

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

  @IsString()
  @IsOptional()
  sortBy?: string;

  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
