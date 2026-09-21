import { Injectable } from '@nestjs/common';
import {
  FixedAssetStatus,
  Prisma,
  PrepaidExpenseStatus,
  PurchaseLineTreatment,
} from '@prisma/client';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { buildDepreciationSchedule } from '../../fixed-assets/depreciation-schedule';
import { buildMonthlyRecognitionSchedule } from '../../prepaid-expenses/prepaid-schedule';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Net (pre-tax) line amount — what the invoice JE debits for the line. */
export function purchaseLineNetAmount(item: {
  lineTotal: Prisma.Decimal | number;
  taxAmount: Prisma.Decimal | number;
}): number {
  return round2(Number(item.lineTotal) - Number(item.taxAmount));
}

/**
 * Creates the Fixed Asset / Prepaid Expense a posted Purchase Invoice line
 * stands for, inside the invoice's own posting transaction. The invoice JE
 * is the capitalization/deferral entry, so the asset is born CAPITALIZED
 * and the prepayment ACTIVE with no second entry; only the future
 * depreciation/recognition schedule posts later. Keyed by the invoice line
 * (unique): re-running the confirm can never create a duplicate.
 */
@Injectable()
export class PurchaseLineRecognitionService {
  constructor(private readonly numberingEngine: NumberingEngineService) {}

  async recognize(
    invoiceId: string,
    tx: Prisma.TransactionClient,
    userId?: string,
  ): Promise<{ assetIds: string[]; prepaidIds: string[] }> {
    const invoice = await tx.purchaseInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: {
        items: {
          where: {
            deletedAt: null,
            treatment: { not: PurchaseLineTreatment.STANDARD },
          },
          include: {
            product: { select: { name: true, displayName: true } },
            fixedAsset: { select: { id: true } },
            prepaidExpense: { select: { id: true } },
          },
        },
      },
    });
    const rate =
      invoice.exchangeRate != null ? Number(invoice.exchangeRate) : 1;
    const postedOn = invoice.confirmedAt ?? new Date();
    const assetIds: string[] = [];
    const prepaidIds: string[] = [];

    for (const item of invoice.items) {
      const label =
        item.description?.trim() ||
        item.product.displayName ||
        item.product.name;
      // Base-currency amount — equals the invoice JE's own debit for this
      // line (the provider posts one line per capitalized/deferred item).
      const baseAmount = round2(purchaseLineNetAmount(item) * rate);
      const start = item.scheduleStartDate ?? postedOn;

      if (item.treatment === PurchaseLineTreatment.FIXED_ASSET) {
        if (item.fixedAsset) {
          assetIds.push(item.fixedAsset.id);
          continue;
        }
        const months = item.assetUsefulLifeMonths ?? 0;
        const method = item.assetDepreciationMethod ?? 'STRAIGHT_LINE';
        const asset = await tx.fixedAsset.create({
          data: {
            name: label,
            code: await this.numberingEngine.generateNumber(
              'FIXED_ASSET',
              undefined,
              tx,
            ),
            acquisitionDate: postedOn,
            cost: baseAmount,
            costCenterId: invoice.costCenterId,
            status: FixedAssetStatus.CAPITALIZED,
            usefulLifeMonths: months,
            depreciationMethod: method,
            depreciationStartDate: start,
            partnerId: invoice.partnerId,
            capitalizedAt: postedOn,
            capitalizedBy: userId ?? null,
            purchaseInvoiceId: invoice.id,
            purchaseInvoiceItemId: item.id,
            notes: `Capitalized by Purchase Invoice ${invoice.invoiceNumber}`,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
            depreciationPeriods: {
              create: buildDepreciationSchedule(
                method,
                baseAmount,
                0,
                months,
                start,
              ),
            },
          },
          select: { id: true },
        });
        assetIds.push(asset.id);
        continue;
      }

      if (item.prepaidExpense) {
        prepaidIds.push(item.prepaidExpense.id);
        continue;
      }
      const months = item.prepaidMonths ?? 1;
      const periods = buildMonthlyRecognitionSchedule(
        baseAmount,
        months,
        start,
      );
      const prepaid = await tx.prepaidExpense.create({
        data: {
          prepaidNumber: await this.numberingEngine.generateNumber(
            'PREPAID_EXPENSE',
            undefined,
            tx,
          ),
          name: label,
          amount: baseAmount,
          startDate: start,
          endDate: periods[periods.length - 1].periodEnd,
          totalPeriods: months,
          status: PrepaidExpenseStatus.ACTIVE,
          expenseAccountId: item.prepaidExpenseAccountId!,
          partnerId: invoice.partnerId,
          activatedAt: postedOn,
          activatedBy: userId ?? null,
          purchaseInvoiceId: invoice.id,
          purchaseInvoiceItemId: item.id,
          notes: `Deferred by Purchase Invoice ${invoice.invoiceNumber}`,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
          recognitions: { create: periods },
        },
        select: { id: true },
      });
      prepaidIds.push(prepaid.id);
    }
    return { assetIds, prepaidIds };
  }
}
