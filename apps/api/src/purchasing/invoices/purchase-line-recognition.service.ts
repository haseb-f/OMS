import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AccountingScheduleStatus,
  FixedAssetStatus,
  Prisma,
  PrepaidExpenseStatus,
  PurchaseLineTreatment,
} from '@prisma/client';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import {
  buildDepreciationSchedule,
  respreadRemainingAmounts,
} from '../../fixed-assets/depreciation-schedule';
import { buildMonthlyRecognitionSchedule } from '../../prepaid-expenses/prepaid-schedule';
import { businessDateOf } from '../../common/time/business-date';
import { dateOnly } from '../../accounting/schedules/schedule-due';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataActivityLogService } from '../../master-data/master-data-activity-log.service';
import { recognizedLineAmount } from './purchase-line-treatment';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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
      // line (the provider posts one line per capitalized/deferred item):
      // net, plus the non-recoverable tax of a FIXED_ASSET line (IAS 16).
      const baseAmount = round2(recognizedLineAmount(item) * rate);
      const start = item.scheduleStartDate ?? postedOn;

      if (
        item.treatment === PurchaseLineTreatment.FIXED_ASSET &&
        item.linkedFixedAssetId
      ) {
        await this.addCostToAsset(
          item.linkedFixedAssetId,
          {
            itemId: item.id,
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            baseAmount,
            postedOn,
          },
          tx,
          userId,
        );
        assetIds.push(item.linkedFixedAssetId);
        continue;
      }

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
    // Directly attributable costs already added to the draft by earlier
    // invoices stay part of its cost (their own invoice JEs debited them).
    const additions = await tx.fixedAssetCostAddition.aggregate({
      where: { fixedAssetId: asset.id },
      _sum: { amount: true },
    });
    const cost = round2(line.baseAmount + Number(additions._sum.amount ?? 0));
    if (salvage > cost) {
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
        cost,
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
            cost,
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

  /**
   * R13b (O-2, IAS 16) — a FIXED_ASSET line that references an existing
   * asset adds a directly attributable cost to it instead of creating a
   * second asset. The invoice JE already debited Fixed Assets for the line;
   * here the asset cost grows by the same base amount and, for a
   * capitalized asset, the remaining PENDING depreciation is re-spread
   * prospectively over the remaining periods (change in estimate — posted
   * periods are never touched). Keyed by the invoice line (unique): a
   * re-run never adds the cost twice.
   */
  private async addCostToAsset(
    assetId: string,
    line: {
      itemId: string;
      invoiceId: string;
      invoiceNumber: string;
      baseAmount: number;
      postedOn: Date;
    },
    tx: Prisma.TransactionClient,
    userId?: string,
  ) {
    await tx.$queryRaw`SELECT id FROM fixed_assets WHERE id = ${assetId}::uuid FOR UPDATE`;
    const existing = await tx.fixedAssetCostAddition.findUnique({
      where: { purchaseInvoiceItemId: line.itemId },
      select: { id: true },
    });
    if (existing) return;
    const asset = await tx.fixedAsset.findUnique({
      where: { id: assetId },
      include: {
        depreciationPeriods: {
          where: { status: AccountingScheduleStatus.PENDING },
          orderBy: { periodStart: 'asc' },
        },
      },
    });
    if (!asset || asset.deletedAt) {
      throw new BadRequestException(
        `The fixed asset a line of Purchase Invoice ${line.invoiceNumber} adds its cost to no longer exists.`,
      );
    }
    if (
      asset.status !== FixedAssetStatus.DRAFT &&
      asset.status !== FixedAssetStatus.CAPITALIZED
    ) {
      throw new BadRequestException(
        `${asset.code} is ${asset.status}; a cost can only be added to a Draft or Capitalized asset.`,
      );
    }
    const pending = asset.depreciationPeriods;
    if (asset.status === FixedAssetStatus.CAPITALIZED && pending.length === 0) {
      throw new BadRequestException(
        `${asset.code} has no remaining depreciation periods to absorb an added cost. Record the cost as a new asset instead.`,
      );
    }
    const cost = round2(Number(asset.cost) + line.baseAmount);
    if (asset.status === FixedAssetStatus.CAPITALIZED) {
      const bookValue = round2(cost - Number(asset.accumulatedDepreciation));
      const amounts = respreadRemainingAmounts(
        asset.depreciationMethod,
        bookValue,
        Number(asset.salvageValue),
        pending.length,
        pending[0].periodStart,
      );
      for (const [index, period] of pending.entries()) {
        await tx.fixedAssetDepreciationPeriod.update({
          where: { id: period.id },
          data: { amount: amounts[index] },
        });
      }
    }
    await tx.fixedAsset.update({
      where: { id: assetId },
      data: { cost, updatedBy: userId ?? null },
    });
    await tx.fixedAssetCostAddition.create({
      data: {
        fixedAssetId: assetId,
        purchaseInvoiceItemId: line.itemId,
        purchaseInvoiceId: line.invoiceId,
        amount: line.baseAmount,
        addedOn: line.postedOn,
        respreadPeriods:
          asset.status === FixedAssetStatus.CAPITALIZED ? pending.length : 0,
        createdBy: userId ?? null,
      },
    });
    await this.activityLog.log(
      'FIXED_ASSET',
      assetId,
      'COST_ADDED',
      `Cost ${line.baseAmount} added by Purchase Invoice ${line.invoiceNumber}` +
        (asset.status === FixedAssetStatus.CAPITALIZED
          ? ` — ${pending.length} remaining depreciation period(s) re-spread`
          : ''),
      userId,
      {
        purchaseInvoiceId: line.invoiceId,
        itemId: line.itemId,
        amount: line.baseAmount,
      },
      tx,
    );
  }

  /**
   * Save-time check of the assets FIXED_ASSET lines add their cost to: the
   * asset exists, is Draft or Capitalized, and a capitalized one still has
   * PENDING periods to absorb the cost. Re-checked under lock at confirm.
   */
  async assertCostAdditionTargets(assetIds: string[]): Promise<void> {
    const ids = [...new Set(assetIds)];
    if (ids.length === 0) return;
    const assets = await this.prisma.fixedAsset.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        code: true,
        status: true,
        deletedAt: true,
        _count: {
          select: {
            depreciationPeriods: {
              where: { status: AccountingScheduleStatus.PENDING },
            },
          },
        },
      },
    });
    for (const id of ids) {
      const asset = assets.find((row) => row.id === id);
      if (!asset || asset.deletedAt) {
        throw new BadRequestException(
          'The fixed asset selected for "Add to existing asset" was not found.',
        );
      }
      if (
        asset.status !== FixedAssetStatus.DRAFT &&
        asset.status !== FixedAssetStatus.CAPITALIZED
      ) {
        throw new BadRequestException(
          `${asset.code} is ${asset.status}; a cost can only be added to a Draft or Capitalized asset.`,
        );
      }
      if (
        asset.status === FixedAssetStatus.CAPITALIZED &&
        asset._count.depreciationPeriods === 0
      ) {
        throw new BadRequestException(
          `${asset.code} has no remaining depreciation periods to absorb an added cost. Record the cost as a new asset instead.`,
        );
      }
    }
  }
}
