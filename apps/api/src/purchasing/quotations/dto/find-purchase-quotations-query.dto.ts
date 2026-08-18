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
import {
  TransformEnumList,
  IsOptionalUuidList,
} from '../../../common/query/enum-list';

export class FindPurchaseQuotationsQueryDto {
  @IsOptionalUuidList()
  supplierId?: string[];

  @TransformEnumList()
  @IsEnum(PurchaseDocumentStatus, { each: true })
  @IsOptional()
  status?: PurchaseDocumentStatus[];

  /** Matches Quotation Number or Reference Number (case-insensitive, partial). */
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
