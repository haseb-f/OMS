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
import {
  TransformEnumList,
  IsOptionalUuidList,
} from '../../../common/query/enum-list';

/**
 * R22 contract 5 — `sortBy` values the list accepts: SalesInvoice scalar
 * columns, plus `customer` (the list's party column → partner name). Derived
 * figures (paid / remaining) are not sortable server-side.
 */
export const SALES_INVOICE_SORTABLE_FIELDS = [
  'invoiceNumber',
  'customer',
  'referenceNumber',
  'status',
  'subtotal',
  'discountTotal',
  'taxTotal',
  'grandTotal',
  'confirmedAt',
  'createdAt',
  'updatedAt',
] as const;

export class FindSalesInvoicesQueryDto {
  @IsOptionalUuidList()
  partnerId?: string[];

  @TransformEnumList()
  @IsEnum(SalesDocumentStatus, { each: true })
  @IsOptional()
  status?: SalesDocumentStatus[];

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

  /** Only real, sortable columns — anything else is a 400, never a Prisma 500. */
  @IsIn(SALES_INVOICE_SORTABLE_FIELDS)
  @IsOptional()
  sortBy?: string;

  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
