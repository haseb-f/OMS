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
import { SalesDocumentStatus } from '@prisma/client';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

export class FindSalesInvoicesQueryDto {
  @IsOptionalUuid()
  customerId?: string;

  @IsEnum(SalesDocumentStatus)
  @IsOptional()
  status?: SalesDocumentStatus;

  /** Matches Invoice Number or Reference Number (case-insensitive, partial). */
  @IsString()
  @IsOptional()
  search?: string;

  /** Filters by `createdAt` — the same column the list's "Date" column shows. */
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
