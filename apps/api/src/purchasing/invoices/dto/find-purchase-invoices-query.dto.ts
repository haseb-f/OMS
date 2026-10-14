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

/**
 * R22 contract 5 — `sortBy` values the list accepts: PurchaseInvoice scalar
 * columns, plus `supplier` (the list's party column → partner name). Derived
 * figures (paid / remaining) are not sortable server-side.
 */
export const PURCHASE_INVOICE_SORTABLE_FIELDS = [
  'invoiceNumber',
  'supplier',
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

export class FindPurchaseInvoicesQueryDto {
  @IsOptionalUuidList()
  partnerId?: string[];

  @TransformEnumList()
  @IsEnum(PurchaseDocumentStatus, { each: true })
  @IsOptional()
  status?: PurchaseDocumentStatus[];

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

  /** Only real, sortable columns — anything else is a 400, never a Prisma 500. */
  @IsIn(PURCHASE_INVOICE_SORTABLE_FIELDS)
  @IsOptional()
  sortBy?: string;

  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
