import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  BankTransactionMatchStatus,
  CashFlowDirection,
  CashFlowOutgoingType,
} from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Mirrors FindJournalEntriesQueryDto's search/pagination shape. */
export class FindBankTransactionsQueryDto {
  @IsEnum(BankTransactionMatchStatus)
  @IsOptional()
  matchStatus?: BankTransactionMatchStatus;

  @IsEnum(CashFlowDirection)
  @IsOptional()
  direction?: CashFlowDirection;

  @IsEnum(CashFlowOutgoingType)
  @IsOptional()
  outgoingType?: CashFlowOutgoingType;

  @IsOptionalUuid()
  cashSourceId?: string;

  /** Matches Reference, Description, Account, or Bank Name (case-insensitive, partial). */
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

  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
