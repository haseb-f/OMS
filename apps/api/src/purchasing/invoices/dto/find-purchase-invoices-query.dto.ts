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
import { PurchaseDocumentStatus } from '@prisma/client';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

export class FindPurchaseInvoicesQueryDto {
  @IsOptionalUuid()
  supplierId?: string;

  @IsEnum(PurchaseDocumentStatus)
  @IsOptional()
  status?: PurchaseDocumentStatus;

  /** Matches Invoice Number or Reference Number (case-insensitive, partial). */
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
