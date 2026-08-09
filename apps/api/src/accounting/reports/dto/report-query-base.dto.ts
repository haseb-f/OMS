import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * TASK-047 Financial Reports — the common filter/pagination shape every
 * report (General Ledger, Trial Balance, Journal Report, Account Statement)
 * extends. Read-only reporting layer only; never used by any write path.
 */
export class ReportQueryBaseDto {
  @IsUUID()
  @IsOptional()
  companyId?: string;

  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsUUID()
  @IsOptional()
  costCenterId?: string;

  @IsUUID()
  @IsOptional()
  projectId?: string;

  @IsUUID()
  @IsOptional()
  currencyId?: string;

  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;

  /**
   * Default true — excludes DRAFT entries only. REVERSED entries are always
   * included even when true: excluding a REVERSED entry while including its
   * separate POSTED reversing entry would asymmetrically corrupt computed
   * balances, so DRAFT is the only status this toggle ever excludes.
   */
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  postedOnly?: boolean = true;

  @IsString()
  @IsOptional()
  search?: string;

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
  sortOrder?: 'asc' | 'desc' = 'asc';
}
