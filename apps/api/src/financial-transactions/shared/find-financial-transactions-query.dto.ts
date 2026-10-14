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
import { FinancialTransactionStatus, type Prisma } from '@prisma/client';
import { TransformEnumList } from '../../common/query/enum-list';
import { listOrderBy } from '../../common/query/list-order-by';

/**
 * R22 contract 5 — the party / account columns of the voucher lists, sorted
 * through their relation (never a raw Prisma field name the client sends).
 */
const RELATION_SORTS: Record<
  string,
  (
    direction: 'asc' | 'desc',
  ) => Prisma.FinancialTransactionOrderByWithRelationInput
> = {
  customer: (direction) => ({ partner: { name: direction } }),
  supplier: (direction) => ({ partner: { name: direction } }),
  partner: (direction) => ({ partner: { name: direction } }),
  counterparty: (direction) => ({ partner: { name: direction } }),
  paidFrom: (direction) => ({ receivingAccount: { name: direction } }),
  receivingAccount: (direction) => ({ receivingAccount: { name: direction } }),
  costCenter: (direction) => ({ costCenter: { name: direction } }),
};

/**
 * `sortBy` values every voucher list (receipts, supplier payments, refunds,
 * expenses) accepts: FinancialTransaction scalar columns plus the relation
 * columns above. Anything else is a 400, never a Prisma 500.
 */
export const FINANCIAL_TRANSACTION_SORTABLE_FIELDS = [
  'transactionNumber',
  'referenceNumber',
  'description',
  'status',
  'amount',
  'feeAmount',
  'transactionDate',
  'confirmedAt',
  'createdAt',
  'updatedAt',
  ...Object.keys(RELATION_SORTS),
];

/** The list order of a voucher list: relation columns by name, the rest by column; ties break by id. */
export function financialTransactionOrderBy(query: {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}): Prisma.FinancialTransactionOrderByWithRelationInput[] {
  const relation = query.sortBy ? RELATION_SORTS[query.sortBy] : undefined;
  if (relation) {
    const direction = query.sortOrder ?? 'desc';
    return [relation(direction), { id: direction }];
  }
  return listOrderBy(query);
}

/** Shared search/pagination shape for both Customer Receipts and Supplier Payments — mirrors FindPurchaseQuotationsQueryDto. */
export class FindFinancialTransactionsQueryDto {
  @TransformEnumList()
  @IsEnum(FinancialTransactionStatus, { each: true })
  @IsOptional()
  status?: FinancialTransactionStatus[];

  /** Matches Transaction Number or Reference Number (case-insensitive, partial). */
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
  @IsIn(FINANCIAL_TRANSACTION_SORTABLE_FIELDS)
  @IsOptional()
  sortBy?: string;

  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
