import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountingScheduleStatus,
  FixedAsset,
  FixedAssetDepreciationPeriod,
  FixedAssetStatus,
  PartnerRoleType,
  Prisma,
  PurchaseDocumentStatus,
  PurchaseLineTreatment,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
  MasterDataListResult,
} from '../master-data/master-data-crud.service';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { UpdateFixedAssetDto } from './dto/update-fixed-asset.dto';
import {
  CapitalizeFixedAssetDto,
  DepreciationPreviewDto,
  DepreciationPreviewParamsDto,
  DisposeFixedAssetDto,
  LinkInvoiceLineDto,
  RunDepreciationDto,
} from './dto/lifecycle.dto';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import { PartnersService } from '../partners/partners.service';
import {
  buildDepreciationSchedule,
  withRunningTotals,
} from './depreciation-schedule';
import {
  dateOnly,
  dateOnlyString,
  dueThrough,
} from '../accounting/schedules/schedule-due';
import {
  postedEntriesBySource,
  SOURCE_INVOICE_SELECT,
} from '../accounting/schedules/source-journal';
import { todayBusinessDate } from '../common/time/business-date';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const INCLUDE = {
  costCenter: true,
  receivingAccount: true,
  partner: true,
  disposalPartner: { select: { id: true, name: true, partnerNumber: true } },
  depreciationPeriods: { orderBy: { periodStart: 'asc' as const } },
};

const DETAIL_INCLUDE = {
  ...INCLUDE,
  ...SOURCE_INVOICE_SELECT,
  purchaseReturn: { select: { id: true, returnNumber: true, status: true } },
  costAdditions: {
    orderBy: { addedOn: 'asc' as const },
    include: {
      purchaseInvoiceItem: {
        select: {
          id: true,
          description: true,
          purchaseInvoice: { select: { id: true, invoiceNumber: true } },
        },
      },
    },
  },
};

/** Asset fields a purchase return of its invoice line is judged on. */
export interface ReturnableAsset {
  id: string;
  code: string | null;
  status: FixedAssetStatus;
  deletedAt: Date | null;
}

@Injectable()
export class FixedAssetsService extends MasterDataCrudService<FixedAsset> {
  protected readonly entityType = 'FIXED_ASSET';
  protected readonly entityLabel = 'Fixed Asset';
  protected readonly searchFields = ['name', 'code'];
  protected readonly defaultSortField = 'acquisitionDate';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
    private readonly partnersService: PartnersService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<FixedAsset> {
    return this.prisma.fixedAsset as unknown as MasterDataDelegate<FixedAsset>;
  }

  findAll(
    query: MasterDataQueryDto,
  ): Promise<MasterDataListResult<FixedAsset>> {
    return super.findAll(query, {}, { include: INCLUDE });
  }

  async findOne(id: string) {
    const entity = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    if (!entity) throw new NotFoundException(`Fixed Asset ${id} not found`);
    return entity;
  }

  /**
   * Detail view: parameters, source invoice line, the full schedule with
   * each row's journal entry (resolved by sourceType + sourceId = row id),
   * the capitalization / disposal entries and the running amounts.
   * An invoice-capitalized asset's capitalization entry IS the invoice JE.
   */
  async detail(id: string) {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, deletedAt: null },
      include: DETAIL_INCLUDE,
    });
    if (!asset) throw new NotFoundException(`Fixed Asset ${id} not found`);
    const periodEntries = await postedEntriesBySource(
      this.prisma,
      'FIXED_ASSET_DEPRECIATION',
      asset.depreciationPeriods.map((period) => period.id),
    );
    const capitalizedByInvoice =
      Boolean(asset.purchaseInvoiceItemId && asset.purchaseInvoiceId) &&
      asset.status !== FixedAssetStatus.DRAFT;
    const capitalization = capitalizedByInvoice
      ? await postedEntriesBySource(this.prisma, 'PURCHASE_INVOICE', [
          asset.purchaseInvoiceId!,
        ]).then((map) => map.get(asset.purchaseInvoiceId!) ?? null)
      : await postedEntriesBySource(this.prisma, 'FIXED_ASSET_CAPITALIZATION', [
          asset.id,
        ]).then((map) => map.get(asset.id) ?? null);
    // An asset returned to its supplier is derecognized by the purchase
    // return's own JE (it credits Fixed Assets) — never a disposal entry.
    const disposalSource = asset.purchaseReturnId
      ? 'PURCHASE_RETURN'
      : 'FIXED_ASSET_DISPOSAL';
    const disposalSourceId = asset.purchaseReturnId ?? asset.id;
    const disposal = await postedEntriesBySource(this.prisma, disposalSource, [
      disposalSourceId,
    ]).then((map) => map.get(disposalSourceId) ?? null);

    const cost = Number(asset.cost);
    const salvage = Number(asset.salvageValue);
    const accumulated = Number(asset.accumulatedDepreciation);
    const count = (status: AccountingScheduleStatus) =>
      asset.depreciationPeriods.filter((period) => period.status === status)
        .length;
    return {
      ...asset,
      depreciationPeriods: asset.depreciationPeriods.map((period) => ({
        ...period,
        journalEntry: periodEntries.get(period.id) ?? null,
      })),
      journalEntries: {
        capitalization,
        capitalizationSource: capitalizedByInvoice
          ? 'PURCHASE_INVOICE'
          : 'FIXED_ASSET_CAPITALIZATION',
        disposal,
        disposalSource,
      },
      summary: {
        cost,
        salvageValue: salvage,
        accumulatedDepreciation: accumulated,
        bookValue: round2(cost - accumulated),
        remainingDepreciable:
          asset.status === FixedAssetStatus.DISPOSED
            ? 0
            : Math.max(round2(cost - salvage - accumulated), 0),
        postedPeriods: count(AccountingScheduleStatus.POSTED),
        pendingPeriods: count(AccountingScheduleStatus.PENDING),
        cancelledPeriods: count(AccountingScheduleStatus.CANCELLED),
        failedPeriods: asset.depreciationPeriods.filter(
          (period) =>
            period.status === AccountingScheduleStatus.PENDING &&
            period.lastError,
        ).length,
        costAdditions: round2(
          asset.costAdditions.reduce((sum, row) => sum + Number(row.amount), 0),
        ),
      },
    };
  }

  /** Schedule an unsaved asset form would get — same math as capitalization. */
  previewSchedule(dto: DepreciationPreviewDto) {
    return this.buildPreview(
      dto.depreciationMethod ?? 'STRAIGHT_LINE',
      dto.cost,
      dto.salvageValue ?? 0,
      dto.usefulLifeMonths,
      dto.depreciationStartDate,
    );
  }

  /**
   * Schedule of a saved asset: the stored rows once capitalized, otherwise
   * what capitalizing with the asset's parameters (or `overrides`) would
   * create. Life is required to preview.
   */
  async previewScheduleFor(
    id: string,
    overrides: DepreciationPreviewParamsDto,
  ) {
    const asset = await this.findOne(id);
    if (asset.status !== FixedAssetStatus.DRAFT) {
      const rows = withRunningTotals(
        asset.depreciationPeriods.map((period) => ({
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          amount: Number(period.amount),
        })),
        Number(asset.cost),
      );
      return {
        method: asset.depreciationMethod,
        cost: Number(asset.cost),
        salvageValue: Number(asset.salvageValue),
        depreciableAmount: round2(
          Number(asset.cost) - Number(asset.salvageValue),
        ),
        usefulLifeMonths: asset.usefulLifeMonths,
        startDate: asset.depreciationStartDate
          ? dateOnlyString(asset.depreciationStartDate)
          : null,
        endDate: rows.at(-1)?.periodEnd ?? null,
        periods: rows,
      };
    }
    const months = overrides.usefulLifeMonths ?? asset.usefulLifeMonths;
    if (!months) {
      throw new BadRequestException(
        `Enter the useful life (months) of ${asset.code ?? asset.name} to preview its depreciation schedule.`,
      );
    }
    const start =
      overrides.depreciationStartDate ??
      dateOnlyString(asset.depreciationStartDate ?? asset.acquisitionDate);
    return this.buildPreview(
      overrides.depreciationMethod ?? asset.depreciationMethod,
      Number(asset.cost),
      overrides.salvageValue ?? Number(asset.salvageValue),
      months,
      start,
    );
  }

  private buildPreview(
    method: 'STRAIGHT_LINE' | 'DECLINING_BALANCE',
    cost: number,
    salvage: number,
    months: number,
    start: string,
  ) {
    this.assertSalvage(cost, salvage);
    const rows = withRunningTotals(
      buildDepreciationSchedule(method, cost, salvage, months, dateOnly(start)),
      cost,
    );
    return {
      method,
      cost,
      salvageValue: salvage,
      depreciableAmount: round2(cost - salvage),
      usefulLifeMonths: months,
      startDate: dateOnlyString(dateOnly(start)),
      endDate: rows.at(-1)?.periodEnd ?? null,
      periods: rows,
    };
  }

  private assertSalvage(cost: number, salvage: number) {
    if (salvage > cost) {
      throw new BadRequestException(
        `Salvage value (${salvage}) cannot exceed the asset cost (${cost}).`,
      );
    }
  }

  async create(dto: CreateFixedAssetDto, userId?: string) {
    const code =
      dto.code?.trim() ||
      (await this.numberingEngine.generateNumber('FIXED_ASSET'));
    return super.create(
      {
        ...dto,
        code,
        acquisitionDate: new Date(dto.acquisitionDate),
        depreciationStartDate: dto.depreciationStartDate
          ? new Date(dto.depreciationStartDate)
          : undefined,
      },
      userId,
    );
  }

  /**
   * A Draft asset still linked to an unconfirmed invoice line would be
   * adopted (capitalized) by that invoice even after archiving — refuse
   * until it is unlinked.
   */
  async archive(id: string, userId?: string) {
    const asset = await this.findOne(id);
    if (
      asset.status === FixedAssetStatus.DRAFT &&
      asset.purchaseInvoiceItemId
    ) {
      throw new BadRequestException(
        `${asset.code} is linked to a purchase invoice line. Unlink it before archiving.`,
      );
    }
    if (asset.status === FixedAssetStatus.DRAFT) {
      // Its added costs are already in Fixed Assets (posted by their invoices).
      const additions = await this.prisma.fixedAssetCostAddition.count({
        where: { fixedAssetId: id },
      });
      if (additions > 0) {
        throw new BadRequestException(
          `${asset.code} carries costs added by purchase invoices (already in Fixed Assets). Capitalize it instead of archiving it.`,
        );
      }
    }
    return super.archive(id, userId);
  }

  async update(id: string, dto: UpdateFixedAssetDto, userId?: string) {
    const existing = await this.findOne(id);
    if (existing.status !== FixedAssetStatus.DRAFT) {
      throw new BadRequestException(
        `Only a Draft fixed asset can be edited. ${existing.code} is ${existing.status}.`,
      );
    }
    const data: Record<string, unknown> = { ...dto };
    if (dto.acquisitionDate)
      data.acquisitionDate = new Date(dto.acquisitionDate);
    if (dto.depreciationStartDate) {
      data.depreciationStartDate = new Date(dto.depreciationStartDate);
    }
    return super.update(id, data, userId);
  }

  /** Row lock serializing lifecycle transitions (capitalize / dispose) of one asset. */
  private async lockAsset(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM fixed_assets WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async capitalize(id: string, dto: CapitalizeFixedAssetDto, userId?: string) {
    const asset = await this.findOne(id);
    if (asset.status !== FixedAssetStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot capitalize ${asset.code} from ${asset.status}.`,
      );
    }
    if (asset.purchaseInvoiceItemId) {
      // The linked invoice line capitalizes it when the invoice is confirmed
      // (its JE debits Fixed Assets) — a manual capitalization now would
      // count the same cost twice.
      throw new BadRequestException(
        `${asset.code} is linked to a purchase invoice line and is capitalized when that invoice is confirmed. Unlink it to capitalize it manually.`,
      );
    }
    const receivingAccountId =
      dto.receivingAccountId ?? asset.receivingAccountId;
    const partnerId = dto.partnerId ?? asset.partnerId;
    if (!receivingAccountId && !partnerId) {
      throw new BadRequestException(
        'Capitalization requires a receiving account (cash/bank) or a supplier partner.',
      );
    }
    const start = new Date(
      dto.depreciationStartDate ??
        asset.depreciationStartDate ??
        asset.acquisitionDate,
    );
    const salvage = dto.salvageValue ?? Number(asset.salvageValue);
    this.assertSalvage(Number(asset.cost), salvage);
    const added = await this.prisma.fixedAssetCostAddition.aggregate({
      where: { fixedAssetId: id },
      _sum: { amount: true },
    });
    if (Number(asset.cost) < Number(added._sum.amount ?? 0)) {
      throw new BadRequestException(
        `The cost of ${asset.code} (${Number(asset.cost)}) is below the costs already added by purchase invoices (${Number(added._sum.amount)}).`,
      );
    }
    const method = dto.depreciationMethod ?? asset.depreciationMethod;
    const periods = buildDepreciationSchedule(
      method,
      Number(asset.cost),
      salvage,
      dto.usefulLifeMonths,
      start,
    );

    return this.prisma.$transaction(async (tx) => {
      // Re-checked under the row lock: a concurrent capitalization (or a link to an invoice
      // line) that committed after the read above must not be overwritten.
      await this.lockAsset(tx, id);
      const claimed = await tx.fixedAsset.updateMany({
        where: {
          id,
          status: FixedAssetStatus.DRAFT,
          deletedAt: null,
          purchaseInvoiceItemId: null,
        },
        data: {
          status: FixedAssetStatus.CAPITALIZED,
          usefulLifeMonths: dto.usefulLifeMonths,
          depreciationMethod: method,
          salvageValue: salvage,
          depreciationStartDate: start,
          receivingAccountId,
          partnerId,
          capitalizedAt: new Date(),
          capitalizedBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          `${asset.code} was changed by another request (already capitalized, linked or archived). Reload it and try again.`,
        );
      }
      await tx.fixedAssetDepreciationPeriod.deleteMany({
        where: { fixedAssetId: id },
      });
      if (periods.length > 0) {
        await tx.fixedAssetDepreciationPeriod.createMany({
          data: periods.map((period) => ({
            ...period,
            fixedAssetId: id,
          })),
        });
      }
      await this.postingEngine.post(
        'FIXED_ASSET_CAPITALIZATION',
        id,
        userId,
        tx,
      );
      await this.activityLog.log(
        this.entityType,
        id,
        'CAPITALIZED',
        `Fixed asset ${asset.code} capitalized`,
        userId,
        undefined,
        tx,
      );
      return tx.fixedAsset.findUniqueOrThrow({
        where: { id },
        include: INCLUDE,
      });
    });
  }

  /**
   * Posts one depreciation period inside `tx`: claims the PENDING row first
   * (a concurrent run blocks on the row lock and then sees it POSTED, so it
   * never posts twice), posts the JE through the Posting Engine (idempotent
   * on sourceId = period id) and adds the amount to accumulated
   * depreciation. Shared by the scheduled run and the disposal catch-up.
   * Returns false when the row was no longer PENDING.
   */
  private async postDepreciationPeriod(
    period: Pick<
      FixedAssetDepreciationPeriod,
      'id' | 'fixedAssetId' | 'amount'
    >,
    tx: Prisma.TransactionClient,
    userId?: string,
  ): Promise<boolean> {
    const claimed = await tx.fixedAssetDepreciationPeriod.updateMany({
      where: { id: period.id, status: AccountingScheduleStatus.PENDING },
      data: {
        status: AccountingScheduleStatus.POSTED,
        postedAt: new Date(),
        postedBy: userId ?? null,
        lastError: null,
        lastAttemptAt: new Date(),
      },
    });
    if (claimed.count === 0) return false;
    await this.postingEngine.post(
      'FIXED_ASSET_DEPRECIATION',
      period.id,
      userId,
      tx,
    );
    await tx.fixedAsset.update({
      where: { id: period.fixedAssetId },
      data: {
        accumulatedDepreciation: { increment: period.amount },
        updatedBy: userId ?? null,
      },
    });
    return true;
  }

  /**
   * Posts every depreciation period due by `asOf` (default: today in
   * Africa/Cairo) — periods whose end date is on or before that business
   * date; future periods stay PENDING. Each period posts in its own
   * transaction so one failure (locked period, missing mapping) never
   * blocks the rest: it stays PENDING with `lastError`, and a later run
   * retries it without ever duplicating a JE.
   */
  async runDepreciation(dto: RunDepreciationDto, userId?: string) {
    const due = dueThrough(dto.asOf);
    const pending = await this.prisma.fixedAssetDepreciationPeriod.findMany({
      where: {
        status: AccountingScheduleStatus.PENDING,
        periodEnd: due.periodEnd,
        fixedAsset: {
          status: FixedAssetStatus.CAPITALIZED,
          deletedAt: null,
        },
      },
      orderBy: { periodEnd: 'asc' },
    });

    const posted: string[] = [];
    const failures: Array<{ id: string; assetId: string; error: string }> = [];
    for (const period of pending) {
      try {
        const done = await this.prisma.$transaction((tx) =>
          this.postDepreciationPeriod(period, tx, userId),
        );
        if (done) posted.push(period.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.prisma.fixedAssetDepreciationPeriod.update({
          where: { id: period.id },
          data: {
            lastError: message.slice(0, 1000),
            lastAttemptAt: new Date(),
          },
        });
        failures.push({
          id: period.id,
          assetId: period.fixedAssetId,
          error: message,
        });
      }
    }
    return {
      asOf: due.asOfDate,
      postedCount: posted.length,
      periodIds: posted,
      failedCount: failures.length,
      failures,
    };
  }

  /**
   * Disposal, in ONE transaction: (1) catch-up depreciation for every
   * PENDING period ending on or before the disposal date, posted exactly
   * like the scheduled run; (2) the remaining PENDING periods become
   * CANCELLED (kept as history); (3) the derecognition entry, whose
   * accumulated depreciation includes the catch-up. A catch-up period that
   * cannot post (e.g. its month is locked) refuses the disposal — it never
   * skips depreciation silently.
   *
   * Full-month convention (owner decision O-7, adopted): only periods whose
   * END date is on or before the disposal date are caught up — no pro-rata
   * days. Disposed 20 March → depreciation through 28/29 February; March is
   * CANCELLED. Simple and consistent with the monthly schedule.
   *
   * Proceeds (R13b, O-1) are received in a receiving account (cash) or, with
   * `counterpartyPartnerId`, settled as a supplier credit (Dr the partner's
   * payable) — e.g. an asset with posted depreciation returned to its
   * supplier. Gain / loss is computed the same way either way.
   */
  async dispose(id: string, dto: DisposeFixedAssetDto, userId?: string) {
    const asset = await this.findOne(id);
    if (asset.status !== FixedAssetStatus.CAPITALIZED) {
      throw new BadRequestException(
        `Cannot dispose ${asset.code} from ${asset.status}.`,
      );
    }
    if (dto.counterpartyPartnerId) {
      if (dto.receivingAccountId) {
        throw new BadRequestException(
          'Choose either a receiving account (cash proceeds) or a supplier credit, not both.',
        );
      }
      if (!dto.disposalAmount || dto.disposalAmount <= 0) {
        throw new BadRequestException(
          'Enter the amount the supplier credits for the asset.',
        );
      }
      // An active partner holding the SUPPLIER role — the same rule as the
      // expense voucher's counterparty (the credit goes to its payable).
      await this.partnersService.assertActiveForRole(
        dto.counterpartyPartnerId,
        PartnerRoleType.SUPPLIER,
      );
    }
    const today = todayBusinessDate();
    const disposalDate = dto.disposalDate
      ? dateOnlyString(dateOnly(dto.disposalDate))
      : today;
    if (disposalDate > today) {
      throw new BadRequestException(
        `The disposal date ${disposalDate} is in the future.`,
      );
    }
    const due = dueThrough(disposalDate);
    const lastPosted = asset.depreciationPeriods
      .filter((period) => period.status === AccountingScheduleStatus.POSTED)
      .at(-1);
    if (lastPosted && dateOnlyString(lastPosted.periodEnd) > disposalDate) {
      throw new BadRequestException(
        `Depreciation of ${asset.code} is already posted through ${dateOnlyString(lastPosted.periodEnd)}. Choose a disposal date on or after that date.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // A concurrent disposal blocks here, then sees DISPOSED and is refused — it never
      // re-runs the catch-up nor overwrites the first disposal's fields.
      await this.lockAsset(tx, id);
      const current = await tx.fixedAsset.findUnique({
        where: { id },
        select: { status: true, deletedAt: true },
      });
      if (
        !current ||
        current.deletedAt ||
        current.status !== FixedAssetStatus.CAPITALIZED
      ) {
        throw new ConflictException(
          `${asset.code} is no longer capitalized (now ${current?.deletedAt ? 'archived' : (current?.status ?? 'missing')}) — another request changed it. Reload it.`,
        );
      }
      const catchUp = await tx.fixedAssetDepreciationPeriod.findMany({
        where: {
          fixedAssetId: id,
          status: AccountingScheduleStatus.PENDING,
          periodEnd: due.periodEnd,
        },
        orderBy: { periodEnd: 'asc' },
      });
      for (const period of catchUp) {
        try {
          await this.postDepreciationPeriod(period, tx, userId);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new BadRequestException(
            `Cannot dispose ${asset.code}: depreciation for ${dateOnlyString(period.periodStart)} – ${dateOnlyString(period.periodEnd)} must be posted first and could not be: ${message}`,
          );
        }
      }
      const cancelled = await tx.fixedAssetDepreciationPeriod.updateMany({
        where: { fixedAssetId: id, status: AccountingScheduleStatus.PENDING },
        data: {
          status: AccountingScheduleStatus.CANCELLED,
          lastAttemptAt: new Date(),
        },
      });
      const disposed = await tx.fixedAsset.updateMany({
        where: { id, status: FixedAssetStatus.CAPITALIZED, deletedAt: null },
        data: {
          status: FixedAssetStatus.DISPOSED,
          disposedAt: dateOnly(disposalDate),
          disposedBy: userId ?? null,
          disposalAmount: dto.disposalAmount ?? 0,
          disposalNotes: dto.disposalNotes,
          // Proceeds go either to a receiving account (cash) or, as a
          // supplier credit, to the partner's payable — never both.
          disposalPartnerId: dto.counterpartyPartnerId ?? null,
          receivingAccountId: dto.counterpartyPartnerId
            ? asset.receivingAccountId
            : (dto.receivingAccountId ?? asset.receivingAccountId),
          updatedBy: userId ?? null,
        },
      });
      if (disposed.count === 0) {
        throw new ConflictException(
          `${asset.code} was disposed by another request. Reload it.`,
        );
      }
      await this.postingEngine.post('FIXED_ASSET_DISPOSAL', id, userId, tx);
      await this.activityLog.log(
        this.entityType,
        id,
        'DISPOSED',
        `Fixed asset ${asset.code} disposed on ${disposalDate} — ${catchUp.length} catch-up depreciation period(s) posted, ${cancelled.count} future period(s) cancelled${dto.counterpartyPartnerId ? ' — proceeds credited by the supplier' : ''}`,
        userId,
        {
          disposalDate,
          catchUp: catchUp.length,
          cancelled: cancelled.count,
          counterpartyPartnerId: dto.counterpartyPartnerId ?? null,
        },
        tx,
      );
      return tx.fixedAsset.findUniqueOrThrow({
        where: { id },
        include: INCLUDE,
      });
    });
  }

  /**
   * Purchase invoice lines a DRAFT asset may be linked to: FIXED_ASSET
   * treatment, on a DRAFT invoice, not linked to any asset yet.
   */
  async linkableInvoiceLines(search?: string) {
    const term = search?.trim();
    const items = await this.prisma.purchaseInvoiceItem.findMany({
      where: {
        deletedAt: null,
        treatment: PurchaseLineTreatment.FIXED_ASSET,
        fixedAsset: { is: null },
        linkedFixedAssetId: null,
        purchaseInvoice: {
          deletedAt: null,
          status: PurchaseDocumentStatus.DRAFT,
          ...(term
            ? {
                OR: [
                  {
                    invoiceNumber: {
                      contains: term,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    referenceNumber: {
                      contains: term,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    partner: {
                      name: { contains: term, mode: 'insensitive' as const },
                    },
                  },
                ],
              }
            : {}),
        },
      },
      select: {
        id: true,
        description: true,
        quantity: true,
        lineTotal: true,
        taxAmount: true,
        assetUsefulLifeMonths: true,
        product: { select: { name: true, displayName: true } },
        purchaseInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            referenceNumber: true,
            partner: { select: { name: true } },
            currency: { select: { code: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return items.map((item) => ({
      ...item,
      netAmount: round2(Number(item.lineTotal) - Number(item.taxAmount)),
    }));
  }

  /**
   * Links a DRAFT asset to a FIXED_ASSET line of a DRAFT purchase invoice.
   * When the invoice is confirmed, the line adopts this asset (cost = the
   * line's base net amount, capitalized by the invoice JE) instead of
   * creating a second one. One line ↔ one asset (unique key); an asset that
   * was ever capitalized can never be linked — it would be capitalized twice.
   */
  async linkInvoiceLine(id: string, dto: LinkInvoiceLineDto, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.fixedAsset.findFirst({
        where: { id, deletedAt: null },
      });
      if (!asset) throw new NotFoundException(`Fixed Asset ${id} not found`);
      if (asset.status !== FixedAssetStatus.DRAFT || asset.capitalizedAt) {
        throw new BadRequestException(
          `Only a Draft fixed asset that was never capitalized can be linked to a purchase invoice line. ${asset.code} is ${asset.status}.`,
        );
      }
      if (asset.purchaseInvoiceItemId) {
        throw new BadRequestException(
          `${asset.code} is already linked to a purchase invoice line. Unlink it first.`,
        );
      }
      const item = await tx.purchaseInvoiceItem.findFirst({
        where: { id: dto.purchaseInvoiceItemId, deletedAt: null },
        include: {
          fixedAsset: { select: { id: true, code: true } },
          purchaseInvoice: {
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              deletedAt: true,
            },
          },
        },
      });
      if (!item || item.purchaseInvoice.deletedAt) {
        throw new NotFoundException('Purchase invoice line not found.');
      }
      if (item.treatment !== PurchaseLineTreatment.FIXED_ASSET) {
        throw new BadRequestException(
          'Only a purchase invoice line recorded as a fixed asset can be linked.',
        );
      }
      if (item.purchaseInvoice.status !== PurchaseDocumentStatus.DRAFT) {
        throw new BadRequestException(
          `Purchase Invoice ${item.purchaseInvoice.invoiceNumber} is ${item.purchaseInvoice.status}; only a line of a Draft invoice can be linked.`,
        );
      }
      if (item.fixedAsset) {
        throw new BadRequestException(
          `This invoice line is already linked to ${item.fixedAsset.code}.`,
        );
      }
      await tx.fixedAsset.update({
        where: { id },
        data: {
          purchaseInvoiceId: item.purchaseInvoice.id,
          purchaseInvoiceItemId: item.id,
          updatedBy: userId ?? null,
        },
      });
      await this.activityLog.log(
        this.entityType,
        id,
        'INVOICE_LINE_LINKED',
        `Linked to Purchase Invoice ${item.purchaseInvoice.invoiceNumber}`,
        userId,
        { purchaseInvoiceId: item.purchaseInvoice.id, itemId: item.id },
        tx,
      );
      return tx.fixedAsset.findUniqueOrThrow({
        where: { id },
        include: DETAIL_INCLUDE,
      });
    });
  }

  /** Removes the link of a still-DRAFT asset (the invoice is not confirmed yet). */
  async unlinkInvoiceLine(id: string, userId?: string) {
    const asset = await this.findOne(id);
    if (
      asset.status !== FixedAssetStatus.DRAFT ||
      !asset.purchaseInvoiceItemId
    ) {
      throw new BadRequestException(
        `${asset.code} has no invoice link that can be removed.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.fixedAsset.update({
        where: { id },
        data: {
          purchaseInvoiceId: null,
          purchaseInvoiceItemId: null,
          updatedBy: userId ?? null,
        },
      });
      await this.activityLog.log(
        this.entityType,
        id,
        'INVOICE_LINE_UNLINKED',
        `Purchase invoice link removed`,
        userId,
        undefined,
        tx,
      );
      return tx.fixedAsset.findUniqueOrThrow({
        where: { id },
        include: DETAIL_INCLUDE,
      });
    });
  }

  /**
   * R13b (O-2) — assets a purchase invoice FIXED_ASSET line may add its cost
   * to ("Add to existing asset"): Draft assets, and Capitalized assets that
   * still have PENDING periods to absorb the cost.
   */
  async costAdditionTargets(search?: string) {
    const term = search?.trim();
    const assets = await this.prisma.fixedAsset.findMany({
      where: {
        deletedAt: null,
        OR: [
          { status: FixedAssetStatus.DRAFT },
          {
            status: FixedAssetStatus.CAPITALIZED,
            depreciationPeriods: {
              some: { status: AccountingScheduleStatus.PENDING },
            },
          },
        ],
        ...(term
          ? {
              AND: [
                {
                  OR: [
                    { code: { contains: term, mode: 'insensitive' as const } },
                    { name: { contains: term, mode: 'insensitive' as const } },
                  ],
                },
              ],
            }
          : {}),
      },
      select: { id: true, code: true, name: true, status: true, cost: true },
      orderBy: { code: 'asc' },
      take: 50,
    });
    return assets.map((asset) => ({ ...asset, cost: Number(asset.cost) }));
  }

  /**
   * R13b (O-1) — may the invoice line that capitalized `asset` be returned to
   * the supplier? Only a still-capitalized asset with NO posted depreciation
   * and no added costs, and only as a whole (an asset is one unit of
   * account). An asset already depreciated is disposed to the supplier
   * instead (Dispose → supplier credit). Throws a 400 naming the reason.
   */
  async assertLineReturnable(
    asset: ReturnableAsset | null,
    line: { invoicedQuantity: number; returnedQuantity: number },
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    if (!asset || asset.deletedAt) {
      throw new BadRequestException(
        'This invoice line was capitalized as a fixed asset that no longer exists — it cannot be returned.',
      );
    }
    if (asset.status !== FixedAssetStatus.CAPITALIZED) {
      throw new BadRequestException(
        `Fixed asset ${asset.code} is ${asset.status} — its invoice line cannot be returned.`,
      );
    }
    if (line.returnedQuantity !== line.invoicedQuantity) {
      throw new BadRequestException(
        `Fixed asset ${asset.code} is one unit of account — return the whole invoice line (${line.invoicedQuantity}), not part of it.`,
      );
    }
    const [posted, additions] = await Promise.all([
      client.fixedAssetDepreciationPeriod.count({
        where: {
          fixedAssetId: asset.id,
          status: AccountingScheduleStatus.POSTED,
        },
      }),
      client.fixedAssetCostAddition.count({
        where: { fixedAssetId: asset.id },
      }),
    ]);
    if (posted > 0) {
      throw new BadRequestException(
        `Fixed asset ${asset.code} already has ${posted} posted depreciation period(s), so its invoice line cannot be returned. Dispose the asset to the supplier instead (Fixed asset → Dispose → supplier credit).`,
      );
    }
    if (additions > 0) {
      throw new BadRequestException(
        `Fixed asset ${asset.code} carries costs added by later purchase invoices, so its invoice line cannot be returned. Dispose the asset to the supplier instead (Fixed asset → Dispose → supplier credit).`,
      );
    }
  }

  /**
   * R13b (O-1) — inside the purchase return's confirm transaction: the
   * returned asset is derecognized by the return JE itself (it credits Fixed
   * Assets for the line amount), so NO disposal entry is posted. The asset
   * becomes DISPOSED, linked to the return, and every PENDING period is
   * CANCELLED (history kept). Re-checked under the asset row lock.
   */
  async derecognizeByPurchaseReturn(
    assetId: string,
    purchaseReturn: { id: string; returnNumber: string },
    line: { invoicedQuantity: number; returnedQuantity: number },
    returnDate: Date,
    tx: Prisma.TransactionClient,
    userId?: string,
  ): Promise<void> {
    await this.lockAsset(tx, assetId);
    const asset = await tx.fixedAsset.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        code: true,
        status: true,
        deletedAt: true,
        cost: true,
      },
    });
    await this.assertLineReturnable(asset, line, tx);
    const cancelled = await tx.fixedAssetDepreciationPeriod.updateMany({
      where: {
        fixedAssetId: assetId,
        status: AccountingScheduleStatus.PENDING,
      },
      data: {
        status: AccountingScheduleStatus.CANCELLED,
        lastAttemptAt: new Date(),
      },
    });
    await tx.fixedAsset.update({
      where: { id: assetId },
      data: {
        status: FixedAssetStatus.DISPOSED,
        disposedAt: returnDate,
        disposedBy: userId ?? null,
        // The supplier credits the full carrying amount (= cost: nothing was
        // depreciated) — no gain or loss.
        disposalAmount: asset!.cost,
        disposalNotes: `Returned to supplier — Purchase Return ${purchaseReturn.returnNumber}`,
        purchaseReturnId: purchaseReturn.id,
        updatedBy: userId ?? null,
      },
    });
    await this.activityLog.log(
      this.entityType,
      assetId,
      'RETURNED',
      `Fixed asset ${asset!.code} returned to the supplier by Purchase Return ${purchaseReturn.returnNumber} — ${cancelled.count} pending period(s) cancelled`,
      userId,
      { purchaseReturnId: purchaseReturn.id, cancelled: cancelled.count },
      tx,
    );
  }
}
