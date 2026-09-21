import { Prisma } from '@prisma/client';
import type { SalesLineItemInputDto } from '../../sales/shared/sales-line-item-input.dto';
import type { PurchaseLineItemInputDto } from '../../purchasing/shared/purchase-line-item-input.dto';

/**
 * Duplicate copies business content only. Everything a document acquires
 * by moving through its lifecycle — number, status, approvals, postings,
 * exchange-rate snapshot, stock movements, payments/allocations and links
 * to the documents it was converted from — is deliberately NOT copied: the
 * copy is a brand-new Draft that goes through the full workflow itself.
 */

type Decimalish = Prisma.Decimal | number | string | null;

const num = (value: Decimalish) => Number(value ?? 0);
const opt = <T>(value: T | null | undefined): T | undefined =>
  value ?? undefined;

interface CopyableLine {
  productId: string;
  description: string | null;
  warehouseId?: string | null;
  unitId: string | null;
  quantity: number;
  unitPrice: Decimalish;
  discountPercent: Decimalish;
  discountValue: Decimalish;
  taxId: string | null;
  notes: string | null;
}

export function copySalesLines(items: CopyableLine[]): SalesLineItemInputDto[] {
  return items.map((item) => ({
    productId: item.productId,
    description: opt(item.description),
    warehouseId: opt(item.warehouseId),
    unitId: item.unitId as string,
    quantity: item.quantity,
    unitPrice: num(item.unitPrice),
    discountPercent: num(item.discountPercent),
    discountValue: num(item.discountValue),
    taxId: opt(item.taxId),
    notes: opt(item.notes),
  }));
}

export function copyPurchaseLines(
  items: Array<
    CopyableLine & {
      treatment?: PurchaseLineItemInputDto['treatment'] | null;
      assetUsefulLifeMonths?: number | null;
      assetDepreciationMethod?:
        PurchaseLineItemInputDto['assetDepreciationMethod'] | null;
      prepaidMonths?: number | null;
      prepaidExpenseAccountId?: string | null;
    }
  >,
): PurchaseLineItemInputDto[] {
  return items.map((item) => ({
    ...copySalesLines([item])[0],
    treatment: opt(item.treatment),
    assetUsefulLifeMonths: opt(item.assetUsefulLifeMonths),
    assetDepreciationMethod: opt(item.assetDepreciationMethod),
    prepaidMonths: opt(item.prepaidMonths),
    prepaidExpenseAccountId: opt(item.prepaidExpenseAccountId),
  }));
}

export const DUPLICATED_FROM = 'DUPLICATED_FROM';
export const RETURNED_TO_DRAFT = 'RETURNED_TO_DRAFT';
