import { BadRequestException } from '@nestjs/common';
import { Prisma, PurchaseLineTreatment } from '@prisma/client';
import type { PurchaseLineItemInputDto } from '../shared/purchase-line-item-input.dto';

/** Persisted treatment fields for one Purchase Invoice line. */
export function lineTreatmentData(
  item: PurchaseLineItemInputDto,
): Partial<Prisma.PurchaseInvoiceItemUncheckedCreateWithoutPurchaseInvoiceInput> {
  const treatment = item.treatment ?? PurchaseLineTreatment.STANDARD;
  if (treatment === PurchaseLineTreatment.FIXED_ASSET) {
    if (item.linkedFixedAssetId) {
      // R13b (O-2) — a cost addition to an existing asset: no schedule of its own.
      return {
        treatment,
        linkedFixedAssetId: item.linkedFixedAssetId,
        assetUsefulLifeMonths: null,
        assetDepreciationMethod: null,
        scheduleStartDate: null,
        prepaidMonths: null,
        prepaidExpenseAccountId: null,
      };
    }
    return {
      treatment,
      linkedFixedAssetId: null,
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
      linkedFixedAssetId: null,
      prepaidMonths: item.prepaidMonths,
      prepaidExpenseAccountId: item.prepaidExpenseAccountId,
      scheduleStartDate: item.scheduleStartDate
        ? new Date(item.scheduleStartDate)
        : null,
      assetUsefulLifeMonths: null,
      assetDepreciationMethod: null,
    };
  }
  return {
    treatment: PurchaseLineTreatment.STANDARD,
    linkedFixedAssetId: null,
  };
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
    const line = `Line ${index + 1}`;
    if (treatment === PurchaseLineTreatment.STANDARD) {
      if (item.linkedFixedAssetId) {
        throw new BadRequestException(
          `${line}: only a line recorded as a fixed asset can add its cost to an existing asset.`,
        );
      }
      return;
    }
    if (isInventoryItem(item.productId)) {
      throw new BadRequestException(
        `${line}: a stocked product cannot be recorded as a fixed asset or prepaid expense — use a non-stock product for this purchase.`,
      );
    }
    if (
      item.linkedFixedAssetId &&
      treatment !== PurchaseLineTreatment.FIXED_ASSET
    ) {
      throw new BadRequestException(
        `${line}: only a line recorded as a fixed asset can add its cost to an existing asset.`,
      );
    }
    if (
      treatment === PurchaseLineTreatment.FIXED_ASSET &&
      !item.linkedFixedAssetId &&
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The tax fields a capitalization decision needs from a purchase line. */
export interface CapitalizableLine {
  treatment: PurchaseLineTreatment;
  lineTotal: Prisma.Decimal | number;
  taxAmount: Prisma.Decimal | number;
  tax?: { isRecoverable: boolean } | null;
}

/**
 * R13b (O-2, IAS 16) — tax on a FIXED_ASSET line that cannot be reclaimed is
 * part of the asset's cost: it is debited to Fixed Assets with the net
 * amount and never to VAT Input. Recoverable tax stays VAT Input.
 */
export function lineTaxIsCapitalized(item: CapitalizableLine): boolean {
  return (
    item.treatment === PurchaseLineTreatment.FIXED_ASSET &&
    item.tax != null &&
    !item.tax.isRecoverable &&
    Number(item.taxAmount) !== 0
  );
}

/**
 * Document-currency amount a capitalized / deferred line debits (invoice) or
 * credits (return) to Fixed Assets / Prepayments: the net amount, plus the
 * non-recoverable tax of a FIXED_ASSET line.
 */
export function recognizedLineAmount(item: CapitalizableLine): number {
  const net = round2(Number(item.lineTotal) - Number(item.taxAmount));
  return lineTaxIsCapitalized(item)
    ? round2(net + Number(item.taxAmount))
    : net;
}
