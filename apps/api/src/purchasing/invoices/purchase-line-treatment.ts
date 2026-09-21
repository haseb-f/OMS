import { BadRequestException } from '@nestjs/common';
import { Prisma, PurchaseLineTreatment } from '@prisma/client';
import type { PurchaseLineItemInputDto } from '../shared/purchase-line-item-input.dto';

/** Persisted treatment fields for one Purchase Invoice line. */
export function lineTreatmentData(
  item: PurchaseLineItemInputDto,
): Partial<Prisma.PurchaseInvoiceItemUncheckedCreateWithoutPurchaseInvoiceInput> {
  const treatment = item.treatment ?? PurchaseLineTreatment.STANDARD;
  if (treatment === PurchaseLineTreatment.FIXED_ASSET) {
    return {
      treatment,
      assetUsefulLifeMonths: item.assetUsefulLifeMonths,
      assetDepreciationMethod: item.assetDepreciationMethod ?? 'STRAIGHT_LINE',
      scheduleStartDate: item.scheduleStartDate
        ? new Date(item.scheduleStartDate)
        : null,
      prepaidMonths: null,
      prepaidExpenseAccountId: null,
    };
  }
  if (treatment === PurchaseLineTreatment.PREPAID_EXPENSE) {
    return {
      treatment,
      prepaidMonths: item.prepaidMonths,
      prepaidExpenseAccountId: item.prepaidExpenseAccountId,
      scheduleStartDate: item.scheduleStartDate
        ? new Date(item.scheduleStartDate)
        : null,
      assetUsefulLifeMonths: null,
      assetDepreciationMethod: null,
    };
  }
  return { treatment: PurchaseLineTreatment.STANDARD };
}

/**
 * A line may be capitalized or deferred only when it is not stock: a
 * stocked product's cost belongs to Inventory (moving average), never to a
 * Fixed Asset or Prepayment at the same time. Each treatment carries the
 * inputs its schedule needs.
 */
export function assertLineTreatments(
  items: PurchaseLineItemInputDto[],
  isInventoryItem: (productId: string) => boolean,
): void {
  items.forEach((item, index) => {
    const treatment = item.treatment ?? PurchaseLineTreatment.STANDARD;
    if (treatment === PurchaseLineTreatment.STANDARD) return;
    const line = `Line ${index + 1}`;
    if (isInventoryItem(item.productId)) {
      throw new BadRequestException(
        `${line}: a stocked product cannot be recorded as a fixed asset or prepaid expense — use a non-stock product for this purchase.`,
      );
    }
    if (
      treatment === PurchaseLineTreatment.FIXED_ASSET &&
      !item.assetUsefulLifeMonths
    ) {
      throw new BadRequestException(
        `${line}: enter the asset's useful life in months.`,
      );
    }
    if (treatment === PurchaseLineTreatment.PREPAID_EXPENSE) {
      if (!item.prepaidMonths) {
        throw new BadRequestException(
          `${line}: enter how many months the prepayment covers.`,
        );
      }
      if (!item.prepaidExpenseAccountId) {
        throw new BadRequestException(
          `${line}: choose the expense account to recognize the prepayment into.`,
        );
      }
    }
  });
}
