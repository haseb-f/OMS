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

/** Mission Part 39/56 — same filter/pagination shape as the Admin `FindLedgerStatementQueryDto`, minus `investorId` (the Portal never accepts one from the client). */
export class FindPortalStatementQueryDto {
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
  @Max(100)
  @IsOptional()
  pageSize?: number = 20;
}
