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
import { PurchaseOrderStatus, PurchaseType } from '@prisma/client';
import {
  TransformEnumList,
  IsOptionalUuidList,
} from '../../common/query/enum-list';

export class FindPurchaseOrdersQueryDto {
  @IsOptionalUuidList()
  supplierId?: string[];

  @TransformEnumList()
  @IsEnum(PurchaseOrderStatus, { each: true })
  @IsOptional()
  status?: PurchaseOrderStatus[];

  @TransformEnumList()
  @IsEnum(PurchaseType, { each: true })
  @IsOptional()
  purchaseType?: PurchaseType[];

  /** Matches against PO Number or Reference Number (case-insensitive, partial). */
  @IsString()
  @IsOptional()
  search?: string;

  /** TASK-042 — filters by `createdAt`, the same column the list's "Date" column shows, matching Quotation/Invoice/Return. */
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
