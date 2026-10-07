import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PartnerEntitlementKind,
  PartnerProfitPeriodStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingReportsService } from '../accounting/reports/accounting-reports.service';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import { AccountMappingService } from '../accounting/account-mapping/account-mapping.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { businessDateOf } from '../common/time/business-date';
import {
  PARTNER_PROFIT_ADJUSTMENT,
  PARTNER_PROFIT_DISTRIBUTION,
  resolvePartnerProfitAccounts,
} from './company-partner-accounts';
import {
  IN_FORCE_STATUSES,
  parseBusinessDate,
} from './company-partners.service';
import {
  type AgreementInForce,
  type PartnerFrequencyValue,
  type PartnerResult,
  type ProfitFigures,
  computePartnerResult,
  dateValue,
  frequencyWindow,
  isoDate,
  partnerWindows,
  round2HalfUp,
} from './partner-profit-calculator';

const PERIOD_ENTITY = 'PARTNER_PROFIT_PERIOD';

export interface PartnerProfitCalculation {
  version: 1;
  from: string;
  to: string;
  computedAt: string;
  /** The single closing frequency of the agreements in force (null when there are none). */
  frequency: PartnerFrequencyValue | null;
  currency: { id: string; code: string } | null;
  /** Income statement of the whole range — the base the segments split. */
  figures: ProfitFigures;
  partners: Array<PartnerResult & { partnerName: string }>;
  totalEntitlement: number;
  warnings: string[];
}

/**
 * R14 W5 (spec-5 §3-5) — profit sharing of the one company pool.
 *
 * Profit comes ONLY from the journal-based income statement
 * (`AccountingReportsService.incomeStatement`, Cairo business days): gross
 * profit = net revenue − cost of sales, net profit = the statement's net
 * income. Every sale (B2B or online) reaches it once, through its posted
 * SALES_INVOICE entry. Partner distributions post to equity / liability, so
 * they never change the profit they are computed from.
 *
 * Preview (nothing stored) → review (PREVIEW period with snapshot, re-savable)
 * → close (CLOSED, one posting) → adjustments (delta only, snapshot kept).
 */
@Injectable()
export class PartnerProfitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: AccountingReportsService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountMapping: AccountMappingService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  /** Income-statement figures of one inclusive business-day range. */
  async profitFigures(from: string, to: string): Promise<ProfitFigures> {
    const statement = await this.reports.incomeStatement({
      dateFrom: from,
      dateTo: to,
      postedOnly: true,
    });
    const totals = statement.totals;
    const grossProfit = round2HalfUp(totals.grossProfit);
    const netProfit = round2HalfUp(totals.netIncome);
    return {
      netRevenue: round2HalfUp(totals.netRevenue),
      costOfSales: round2HalfUp(totals.costOfSales),
      grossProfit,
      otherExpensesNet: round2HalfUp(
        new Prisma.Decimal(grossProfit).sub(netProfit),
      ),
      netProfit,
    };
  }

  private async agreementsInForce(from: string, to: string) {
    const rows = await this.prisma.partnerAgreement.findMany({
      where: {
        status: { in: IN_FORCE_STATUSES },
        effectiveFrom: { lte: dateValue(to) },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: dateValue(from) } }],
      },
      include: { partner: { select: { name: true } } },
      orderBy: { effectiveFrom: 'asc' },
    });
    return rows.map((row) => ({
      agreement: {
        id: row.id,
        partnerId: row.partnerId,
        percent: Number(row.profitSharePercent),
        basis: row.basis,
        effectiveFrom: isoDate(row.effectiveFrom),
        effectiveTo: row.effectiveTo ? isoDate(row.effectiveTo) : null,
        frequency: row.frequency,
      } satisfies AgreementInForce,
      partnerName: row.partner.name,
    }));
  }

  /** Live estimate for any range — nothing is stored. */
  async calculate(fromInput: string, toInput: string) {
    const from = parseBusinessDate(fromInput, 'from');
    const to = parseBusinessDate(toInput, 'to');
    if (to < from) {
      throw new BadRequestException({
        code: 'INVALID_RANGE',
        message: `"to" (${to}) is before "from" (${from}).`,
      });
    }
    const inForce = await this.agreementsInForce(from, to);
    const frequencies = [
      ...new Set(inForce.map((row) => row.agreement.frequency)),
    ];
    const cache = new Map<string, Promise<ProfitFigures>>();
    const figuresOf = (a: string, b: string) => {
      const key = `${a}|${b}`;
      if (!cache.has(key)) cache.set(key, this.profitFigures(a, b));
      return cache.get(key)!;
    };

    const byPartner = new Map<
      string,
      { name: string; agreements: AgreementInForce[] }
    >();
    for (const row of inForce) {
      const entry = byPartner.get(row.agreement.partnerId) ?? {
        name: row.partnerName,
        agreements: [],
      };
      entry.agreements.push(row.agreement);
      byPartner.set(row.agreement.partnerId, entry);
    }
    const partners: PartnerProfitCalculation['partners'] = [];
    for (const [partnerId, entry] of byPartner) {
      const windows = await Promise.all(
        partnerWindows(entry.agreements, from, to).map(async (w) => ({
          ...w,
          figures: await figuresOf(w.from, w.to),
        })),
      );
      partners.push({
        ...computePartnerResult(partnerId, windows),
        partnerName: entry.name,
      });
    }
    partners.sort((a, b) => a.partnerName.localeCompare(b.partnerName));

    const settings = await this.prisma.postingSettings.findFirst({
      select: { functionalCurrency: { select: { id: true, code: true } } },
    });
    const warnings: string[] = [];
    if (frequencies.length > 1) warnings.push('MIXED_FREQUENCY');
    if (!settings?.functionalCurrency) warnings.push('NO_FUNCTIONAL_CURRENCY');
    if (inForce.length === 0) warnings.push('NO_AGREEMENTS');

    const calculation: PartnerProfitCalculation = {
      version: 1,
      from,
      to,
      computedAt: new Date().toISOString(),
      frequency: frequencies.length === 1 ? frequencies[0] : null,
      currency: settings?.functionalCurrency ?? null,
      figures: await figuresOf(from, to),
      partners,
      totalEntitlement: round2HalfUp(
        partners.reduce((s, p) => s.add(p.amount), new Prisma.Decimal(0)),
      ),
      warnings,
    };
    return calculation;
  }

  // ----------------------------------------------------------------- periods

  async listPeriods() {
    const rows = await this.prisma.partnerProfitPeriod.findMany({
      include: {
        entitlements: { select: { amount: true, kind: true } },
        adjustments: { select: { id: true } },
      },
      orderBy: { periodFrom: 'desc' },
    });
    return rows.map((row) => this.periodSummary(row));
  }

  private periodSummary(
    row: Prisma.PartnerProfitPeriodGetPayload<object> & {
      entitlements: Array<{ amount: Prisma.Decimal; kind: string }>;
      adjustments: Array<{ id: string }>;
    },
  ) {
    const sum = (kind?: string) =>
      round2HalfUp(
        row.entitlements
          .filter((e) => !kind || e.kind === kind)
          .reduce((s, e) => s.add(e.amount), new Prisma.Decimal(0)),
      );
    return {
      id: row.id,
      periodFrom: isoDate(row.periodFrom),
      periodTo: isoDate(row.periodTo),
      frequency: row.frequency,
      status: row.status,
      originalTotal: sum(PartnerEntitlementKind.ORIGINAL),
      adjustmentTotal: sum(PartnerEntitlementKind.ADJUSTMENT),
      total: sum(),
      adjustmentCount: row.adjustments.length,
      reviewedAt: row.reviewedAt,
      closedAt: row.closedAt,
      journalEntryId: row.journalEntryId,
    };
  }

  async findPeriod(id: string) {
    const row = await this.prisma.partnerProfitPeriod.findUnique({
      where: { id },
      include: {
        entitlements: {
          include: { partner: { select: { name: true } } },
          orderBy: [{ kind: 'asc' }, { segmentFrom: 'asc' }],
        },
        adjustments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException(`Profit period ${id} not found`);
    return {
      ...this.periodSummary(row),
      snapshot: row.snapshot as unknown as PartnerProfitCalculation,
      entitlements: row.entitlements.map((e) => ({
        id: e.id,
        partnerId: e.partnerId,
        partnerName: e.partner.name,
        agreementId: e.agreementId,
        adjustmentId: e.adjustmentId,
        kind: e.kind,
        basis: e.basis,
        segmentFrom: isoDate(e.segmentFrom),
        segmentTo: isoDate(e.segmentTo),
        baseAmount: Number(e.baseAmount),
        percent: Number(e.percent),
        days: e.days,
        amount: Number(e.amount),
        journalEntryId: e.journalEntryId,
      })),
      adjustments: row.adjustments.map((a) => ({
        id: a.id,
        reason: a.reason,
        entryDate: isoDate(a.entryDate),
        journalEntryId: a.journalEntryId,
        createdAt: a.createdAt,
        snapshot: a.snapshot as unknown as PartnerProfitCalculation,
      })),
    };
  }

  /** A period is exactly one closing window of the pool's frequency. */
  private assertWindow(calculation: PartnerProfitCalculation) {
    if (calculation.warnings.includes('NO_AGREEMENTS')) {
      throw new BadRequestException({
        code: 'PARTNER_NO_AGREEMENTS',
        message: 'No partner agreement is in force in this period.',
      });
    }
    if (!calculation.frequency) {
      throw new BadRequestException({
        code: 'PARTNER_FREQUENCY_MISMATCH',
        message:
          'The agreements in force in this period close on different frequencies — one company pool closes on one frequency.',
      });
    }
    const window = frequencyWindow(calculation.frequency, calculation.from);
    if (!window || window.to !== calculation.to) {
      throw new BadRequestException({
        code: 'PARTNER_PERIOD_WINDOW',
        message: `A ${calculation.frequency} period runs from the first to the last day of its ${calculation.frequency === 'MONTHLY' ? 'month' : calculation.frequency === 'QUARTERLY' ? 'quarter' : 'year'}${window ? ` (${window.from} → ${window.to})` : ''}.`,
      });
    }
  }

  private entitlementRows(
    calculation: PartnerProfitCalculation,
    periodId: string,
    userId?: string,
  ): Prisma.PartnerEntitlementCreateManyInput[] {
    return calculation.partners.flatMap((partner) =>
      partner.segments.map((segment) => ({
        periodId,
        partnerId: partner.partnerId,
        agreementId: segment.agreementId,
        basis: segment.basis,
        segmentFrom: dateValue(segment.from),
        segmentTo: dateValue(segment.to),
        baseAmount: segment.baseAmount,
        percent: segment.percent,
        days: segment.days,
        amount: segment.amount,
        kind: PartnerEntitlementKind.ORIGINAL,
        createdBy: userId ?? null,
      })),
    );
  }

  /** Review: saves (or refreshes) the period's snapshot. A CLOSED period is never re-saved. */
  async saveReview(periodFrom: string, periodTo: string, userId?: string) {
    const calculation = await this.calculate(periodFrom, periodTo);
    this.assertWindow(calculation);
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lockPeriods(tx);
      const existing = await tx.partnerProfitPeriod.findUnique({
        where: {
          periodFrom_periodTo: {
            periodFrom: dateValue(calculation.from),
            periodTo: dateValue(calculation.to),
          },
        },
      });
      if (existing?.status === PartnerProfitPeriodStatus.CLOSED) {
        throw new ConflictException({
          code: 'PARTNER_PERIOD_CLOSED',
          message: `The period ${calculation.from} → ${calculation.to} is already closed — correct it with an adjustment.`,
        });
      }
      const overlapping = await tx.partnerProfitPeriod.findFirst({
        where: {
          id: existing ? { not: existing.id } : undefined,
          periodFrom: { lte: dateValue(calculation.to) },
          periodTo: { gte: dateValue(calculation.from) },
        },
      });
      if (overlapping) {
        throw new ConflictException({
          code: 'PARTNER_PERIOD_OVERLAP',
          message: `The period overlaps ${isoDate(overlapping.periodFrom)} → ${isoDate(overlapping.periodTo)} (${overlapping.status}).`,
        });
      }
      const data = {
        frequency: calculation.frequency!,
        snapshot: calculation as unknown as Prisma.InputJsonValue,
        reviewedAt: new Date(),
        reviewedBy: userId ?? null,
      };
      const period = existing
        ? await tx.partnerProfitPeriod.update({
            where: { id: existing.id },
            data,
          })
        : await tx.partnerProfitPeriod.create({
            data: {
              ...data,
              periodFrom: dateValue(calculation.from),
              periodTo: dateValue(calculation.to),
              createdBy: userId ?? null,
            },
          });
      // A review's rows are a draft: refreshing the review replaces them.
      await tx.partnerEntitlement.deleteMany({
        where: { periodId: period.id },
      });
      await tx.partnerEntitlement.createMany({
        data: this.entitlementRows(calculation, period.id, userId),
      });
      return period.id;
    });
    await this.activityLog.log(
      PERIOD_ENTITY,
      id,
      'REVIEWED',
      `Profit period ${calculation.from} → ${calculation.to} reviewed (${calculation.totalEntitlement})`,
      userId,
    );
    return this.findPeriod(id);
  }

  private async lockPeriods(tx: Prisma.TransactionClient) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('company-partner-periods'))::text AS locked`;
  }

  private static amountsByPartner(calculation: PartnerProfitCalculation) {
    return new Map(calculation.partners.map((p) => [p.partnerId, p.amount]));
  }

  private static sameFigures(
    a: PartnerProfitCalculation,
    b: PartnerProfitCalculation,
  ) {
    const left = PartnerProfitService.amountsByPartner(a);
    const right = PartnerProfitService.amountsByPartner(b);
    if (left.size !== right.size) return false;
    for (const [partnerId, amount] of left) {
      if (right.get(partnerId) !== amount) return false;
    }
    return (
      a.figures.grossProfit === b.figures.grossProfit &&
      a.figures.netProfit === b.figures.netProfit
    );
  }

  private async requireFunctionalCurrency() {
    const settings = await this.prisma.postingSettings.findFirst({
      select: { functionalCurrencyId: true },
    });
    if (!settings?.functionalCurrencyId) {
      throw new BadRequestException({
        code: 'FUNCTIONAL_CURRENCY_MISSING',
        message:
          'Set the base currency in Settings → Accounting before closing a partner profit period.',
      });
    }
  }

  /**
   * Close / approve: the reviewed figures must still be the ledger's figures
   * (otherwise the reviewer re-saves the review), then ONE posting — Dr
   * distribution / Cr payable per partner. A second close is refused (409);
   * the posting engine is idempotent per period as a second guard.
   */
  async close(id: string, userId?: string) {
    const period = await this.prisma.partnerProfitPeriod.findUnique({
      where: { id },
    });
    if (!period) throw new NotFoundException(`Profit period ${id} not found`);
    if (period.status === PartnerProfitPeriodStatus.CLOSED) {
      throw this.alreadyClosed(period);
    }
    await this.requireFunctionalCurrency();
    await resolvePartnerProfitAccounts(this.accountMapping, this.prisma);
    const fresh = await this.calculate(
      isoDate(period.periodFrom),
      isoDate(period.periodTo),
    );
    const reviewed = period.snapshot as unknown as PartnerProfitCalculation;
    if (!PartnerProfitService.sameFigures(reviewed, fresh)) {
      throw new ConflictException({
        code: 'PARTNER_PERIOD_STALE',
        message:
          'The ledger changed since this period was reviewed — refresh the review, check the new figures, then close.',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM partner_profit_periods WHERE id = ${id}::uuid FOR UPDATE`;
      const locked = await tx.partnerProfitPeriod.findUniqueOrThrow({
        where: { id },
      });
      if (locked.status === PartnerProfitPeriodStatus.CLOSED) {
        throw this.alreadyClosed(locked);
      }
      await tx.partnerProfitPeriod.update({
        where: { id },
        data: {
          status: PartnerProfitPeriodStatus.CLOSED,
          closedAt: new Date(),
          closedBy: userId ?? null,
        },
      });
      const entry = await this.postingEngine.post(
        PARTNER_PROFIT_DISTRIBUTION,
        id,
        userId,
        tx,
      );
      if (entry) {
        await tx.partnerProfitPeriod.update({
          where: { id },
          data: { journalEntryId: entry.id },
        });
        await tx.partnerEntitlement.updateMany({
          where: { periodId: id, kind: PartnerEntitlementKind.ORIGINAL },
          data: { journalEntryId: entry.id },
        });
      }
    });
    await this.activityLog.log(
      PERIOD_ENTITY,
      id,
      'CLOSED',
      `Profit period ${isoDate(period.periodFrom)} → ${isoDate(period.periodTo)} closed`,
      userId,
    );
    return this.findPeriod(id);
  }

  private alreadyClosed(period: { periodFrom: Date; periodTo: Date }) {
    return new ConflictException({
      code: 'PARTNER_PERIOD_ALREADY_CLOSED',
      message: `The period ${isoDate(period.periodFrom)} → ${isoDate(period.periodTo)} is already closed.`,
    });
  }

  /**
   * Correction of a CLOSED period: recompute, post only the per-partner
   * difference from what is already approved (original + earlier
   * adjustments). The original snapshot is never touched.
   */
  async adjust(id: string, reason: string, userId?: string) {
    const period = await this.prisma.partnerProfitPeriod.findUnique({
      where: { id },
      include: { entitlements: true },
    });
    if (!period) throw new NotFoundException(`Profit period ${id} not found`);
    if (period.status !== PartnerProfitPeriodStatus.CLOSED) {
      throw new ConflictException({
        code: 'PARTNER_PERIOD_NOT_CLOSED',
        message:
          'Only a closed period is adjusted — refresh the review of an open period instead.',
      });
    }
    await this.requireFunctionalCurrency();
    await resolvePartnerProfitAccounts(this.accountMapping, this.prisma);
    const fresh = await this.calculate(
      isoDate(period.periodFrom),
      isoDate(period.periodTo),
    );
    const adjustmentId = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM partner_profit_periods WHERE id = ${id}::uuid FOR UPDATE`;
      const approved = await tx.partnerEntitlement.groupBy({
        by: ['partnerId'],
        where: { periodId: id },
        _sum: { amount: true },
      });
      const approvedOf = new Map(
        approved.map((row) => [
          row.partnerId,
          new Prisma.Decimal(String(row._sum.amount ?? 0)),
        ]),
      );
      const freshOf = new Map(fresh.partners.map((p) => [p.partnerId, p]));
      const partnerIds = new Set([...approvedOf.keys(), ...freshOf.keys()]);
      const rows: Prisma.PartnerEntitlementCreateManyInput[] = [];
      for (const partnerId of partnerIds) {
        const now = freshOf.get(partnerId);
        const delta = round2HalfUp(
          new Prisma.Decimal(now?.amount ?? 0).sub(
            approvedOf.get(partnerId) ?? 0,
          ),
        );
        if (delta === 0) continue;
        const lastSegment = now?.segments[now.segments.length - 1];
        const original = period.entitlements
          .filter((e) => e.partnerId === partnerId)
          .at(-1);
        rows.push({
          periodId: id,
          partnerId,
          agreementId: lastSegment?.agreementId ?? original!.agreementId,
          basis: lastSegment?.basis ?? original!.basis,
          segmentFrom: period.periodFrom,
          segmentTo: period.periodTo,
          baseAmount: round2HalfUp(
            (now?.segments ?? []).reduce(
              (s, seg) => s.add(seg.baseAmount),
              new Prisma.Decimal(0),
            ),
          ),
          percent: lastSegment?.percent ?? Number(original!.percent),
          days:
            Math.round(
              (period.periodTo.getTime() - period.periodFrom.getTime()) /
                86_400_000,
            ) + 1,
          amount: delta,
          kind: PartnerEntitlementKind.ADJUSTMENT,
          createdBy: userId ?? null,
        });
      }
      if (rows.length === 0) {
        throw new BadRequestException({
          code: 'PARTNER_ADJUSTMENT_NO_DIFFERENCE',
          message:
            'The recomputed entitlements equal the approved ones — there is nothing to adjust.',
        });
      }
      const adjustment = await tx.partnerProfitAdjustment.create({
        data: {
          periodId: id,
          reason,
          snapshot: fresh as unknown as Prisma.InputJsonValue,
          entryDate: dateValue(businessDateOf(new Date())),
          createdBy: userId ?? null,
        },
      });
      await tx.partnerEntitlement.createMany({
        data: rows.map((row) => ({ ...row, adjustmentId: adjustment.id })),
      });
      const entry = await this.postingEngine.post(
        PARTNER_PROFIT_ADJUSTMENT,
        adjustment.id,
        userId,
        tx,
      );
      if (entry) {
        await tx.partnerProfitAdjustment.update({
          where: { id: adjustment.id },
          data: { journalEntryId: entry.id },
        });
        await tx.partnerEntitlement.updateMany({
          where: { adjustmentId: adjustment.id },
          data: { journalEntryId: entry.id },
        });
      }
      return adjustment.id;
    });
    await this.activityLog.log(
      PERIOD_ENTITY,
      id,
      'ADJUSTED',
      `Profit period adjusted: ${reason}`,
      userId,
      { adjustmentId },
    );
    return this.findPeriod(id);
  }
}
