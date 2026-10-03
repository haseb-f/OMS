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

/**
 * `sortBy` values the list and `/ids` accept: SalesOrderDocument scalar
 * columns, plus `customer` (the list's customer column → partner name).
 */
export const SALES_ORDER_SORTABLE_FIELDS = [
  'orderNumber',
  'customer',
  'referenceNumber',
  'status',
  'subtotal',
  'grandTotal',
  'confirmedAt',
  'createdAt',
  'updatedAt',
];
import {
  TransformEnumList,
  IsOptionalUuidList,
} from '../../../common/query/enum-list';

export class FindSalesOrdersQueryDto {
  @IsOptionalUuidList()
  partnerId?: string[];

  @TransformEnumList()
  @IsEnum(SalesDocumentStatus, { each: true })
  @IsOptional()
  status?: SalesDocumentStatus[];

  /** Matches Order Number or Reference Number (case-insensitive, partial). */
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

  /** Only real, sortable columns — anything else is a 400, never a Prisma 500. */
  @IsIn(SALES_ORDER_SORTABLE_FIELDS)
  @IsOptional()
  sortBy?: string;

  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
