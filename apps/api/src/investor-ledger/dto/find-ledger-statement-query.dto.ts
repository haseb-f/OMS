import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { InvestorLedgerEntryType } from '@prisma/client';
import { TransformEnumList } from '../../common/query/enum-list';

/** Investor Engine Milestone 3, Phase 45/57 — server-side filtered/paginated Investor Statement. */
export class FindLedgerStatementQueryDto {
  @IsUUID()
  @IsOptional()
  opportunityId?: string;

  @TransformEnumList()
  @IsEnum(InvestorLedgerEntryType, { each: true })
  @IsOptional()
  type?: InvestorLedgerEntryType[];

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
}
