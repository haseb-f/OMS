import { BadRequestException, Injectable } from '@nestjs/common';
import {
  FixedAssetStatus,
  Prisma,
  PrepaidExpenseStatus,
  PurchaseLineTreatment,
} from '@prisma/client';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { buildDepreciationSchedule } from '../../fixed-assets/depreciation-schedule';
import { buildMonthlyRecognitionSchedule } from '../../prepaid-expenses/prepaid-schedule';
import { businessDateOf } from '../../common/time/business-date';
import { dateOnly } from '../../accounting/schedules/schedule-due';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataActivityLogService } from '../../master-data/master-data-activity-log.service';

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
 *
 * A DRAFT asset the user linked to the line beforehand is ADOPTED instead
 * of creating a second asset: its cost becomes the line's base net amount
 * and it is capitalized by the invoice JE (no capitalization entry of its
 * own). It keeps its own name / cost center / salvage / method and, when
 * set, its useful life and start date; otherwise the line's are used.
 */
@Injectable()
export class PurchaseLineRecognitionService {
  constructor(
    private readonly numberingEngine: NumberingEngineService,
    private readonly prisma: PrismaService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  /**
   * Editing a Draft invoice's lines recreates them, which would silently
   * drop the link of a Draft asset prepared for one of them. Refuse until
   * the asset is unlinked (Fixed Asset → Unlink invoice line).
   */
  async assertLinesReplaceable(
    invoiceId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const linked = await client.fixedAsset.findMany({
      where: {
        purchaseInvoiceItem: { purchaseInvoiceId: invoiceId },
        deletedAt: null,
      },
      select: { code: true },
    });
    if (linked.length > 0) {
      throw new BadRequestException(
        `The invoice lines are linked to fixed asset(s) ${linked.map((a) => a.code).join(', ')}. Unlink them before changing the lines.`,
      );
    }
  }

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
            fixedAsset: true,
            prepaidExpense: { select: { id: true } },
          },
        },
      },
    });
    const rate =
      invoice.exchangeRate != null ? Number(invoice.exchangeRate) : 1;
    // The business (Africa/Cairo) date of the confirmation — schedule and
    // acquisition dates are date-only.
    const postedOn = dateOnly(
      businessDateOf(invoice.confirmedAt ?? new Date()),
    );
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
          if (item.fixedAsset.status === FixedAssetStatus.DRAFT) {
            await this.adoptDraftAsset(
              item.fixedAsset,
              {
                baseAmount,
                months: item.assetUsefulLifeMonths,
                method: item.assetDepreciationMethod,
                start: item.scheduleStartDate,
                postedOn,
                partnerId: invoice.partnerId,
                invoiceNumber: invoice.invoiceNumber,
              },
              tx,
              userId,
            );
          }
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

  private async adoptDraftAsset(
    asset: {
      id: string;
      code: string | null;
      salvageValue: Prisma.Decimal;
      usefulLifeMonths: number | null;
      depreciationMethod: 'STRAIGHT_LINE' | 'DECLINING_BALANCE';
      depreciationStartDate: Date | null;
      capitalizedAt: Date | null;
      notes: string | null;
    },
    line: {
      baseAmount: number;
      months: number | null;
      method: 'STRAIGHT_LINE' | 'DECLINING_BALANCE' | null;
      start: Date | null;
      postedOn: Date;
      partnerId: string;
      invoiceNumber: string;
    },
    tx: Prisma.TransactionClient,
    userId?: string,
  ) {
    // Defence in depth: linking already refuses a once-capitalized asset.
    if (asset.capitalizedAt) {
      throw new BadRequestException(
        `${asset.code} was already capitalized and cannot be capitalized again by Purchase Invoice ${line.invoiceNumber}.`,
      );
    }
    const salvage = Number(asset.salvageValue);
    if (salvage > line.baseAmount) {
      throw new BadRequestException(
        `${asset.code}: salvage value ${salvage} exceeds the invoice line amount ${line.baseAmount}.`,
      );
    }
    // The invoice line is authoritative for what it specifies (the draft's method always
    // carries a DB default, so "set on the draft" cannot be told apart from "defaulted");
    // the draft asset fills only what the line leaves empty.
    const months = line.months ?? asset.usefulLifeMonths ?? 0;
    const method = line.method ?? asset.depreciationMethod ?? 'STRAIGHT_LINE';
    const requestedStart =
      line.start ?? asset.depreciationStartDate ?? line.postedOn;
    // Depreciation never starts before the acquisition (= the confirmation date set below).
    const start =
      requestedStart.getTime() < line.postedOn.getTime()
        ? line.postedOn
        : requestedStart;
    await tx.fixedAssetDepreciationPeriod.deleteMany({
      where: { fixedAssetId: asset.id },
    });
    await tx.fixedAsset.update({
      where: { id: asset.id },
      data: {
        cost: line.baseAmount,
        acquisitionDate: line.postedOn,
        status: FixedAssetStatus.CAPITALIZED,
        usefulLifeMonths: months,
        depreciationMethod: method,
        depreciationStartDate: start,
        partnerId: line.partnerId,
        capitalizedAt: line.postedOn,
        capitalizedBy: userId ?? null,
        updatedBy: userId ?? null,
        notes: [
          asset.notes,
          `Capitalized by Purchase Invoice ${line.invoiceNumber}`,
        ]
          .filter(Boolean)
          .join('\n'),
        depreciationPeriods: {
          create: buildDepreciationSchedule(
            method,
            line.baseAmount,
            salvage,
            months,
            start,
          ),
        },
      },
    });
    await this.activityLog.log(
      'FIXED_ASSET',
      asset.id,
      'CAPITALIZED',
      `Capitalized by Purchase Invoice ${line.invoiceNumber} (linked draft asset adopted)`,
      userId,
      undefined,
      tx,
    );
  }
}
