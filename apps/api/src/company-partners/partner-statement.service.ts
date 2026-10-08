import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PartnerEntitlementKind,
  PartnerProfitPeriodStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { businessDateOf } from '../common/time/business-date';
import {
  CompanyPartnersService,
  IN_FORCE_STATUSES,
  agreementView,
  parseBusinessDate,
} from './company-partners.service';
import {
  type PartnerProfitCalculation,
  PartnerProfitService,
} from './partner-profit.service';
import { PartnerPaymentsService } from './partner-payments.service';
import { PartnerBalancesService } from './partner-balances.service';
import {
  type PartnerFrequencyValue,
  type PartnerProfitBasisValue,
  type PartnerSegment,
  closingWindows,
  dateValue,
  isoDate,
  maxDate,
  minDate,
  rangesOverlap,
  round2HalfUp,
} from './partner-profit-calculator';
import {
  type PartnershipState,
  type ProfitBaseLines,
  type StatementPeriodStatus,
  allocatePaymentsOldestFirst,
  partnershipState,
  profitBaseLines,
} from './partner-statement-rules';

/** One segment of a period: the terms in force, the profit lines it used, the share. */
export interface StatementSegment {
  from: string;
  to: string;
  days: number;
  percent: number;
  basis: PartnerProfitBasisValue;
  profitBase: ProfitBaseLines;
  baseAmount: number;
  lossClamped: boolean;
  amount: number;
}

/** One closing period of the partner (spec-w4 §5, D15-15). */
export interface StatementPeriodRow {
  /** The saved (reviewed / closed) period; null while nobody has reviewed it. */
  periodId: string | null;
  periodFrom: string;
  periodTo: string;
  frequency: PartnerFrequencyValue;
  /** OPEN = live estimate · UNDER_REVIEW = reviewed, not approved · CLOSED = approved. */
  status: StatementPeriodStatus;
  segments: StatementSegment[];
  /** Calculated entitlement: live estimate (OPEN), reviewed figure (UNDER_REVIEW), approved original (CLOSED). */
  entitlement: number;
  /** CLOSED only — Σ adjustments posted after the close. */
  adjustments: number | null;
  /** CLOSED only — original + adjustments. */
  approvedDue: number | null;
  /** CLOSED only — payments applied oldest-first (derived). */
  paid: number | null;
  /** CLOSED only — approvedDue − paid. */
  remaining: number | null;
}

/** A correction posted to a closed period, as it concerns this partner. */
export interface StatementAdjustmentRow {
  adjustmentId: string;
  periodId: string;
  periodFrom: string;
  periodTo: string;
  /** Entry date of the adjustment posting. */
  date: string;
  reason: string;
  amount: number;
}

/**
 * The per-period statement both audiences read. Partner-safe by
 * construction: this partner's own rows only, no journal entry, no account,
 * no other partner — the internal page adds its own extras around it.
 */
export interface PeriodStatement {
  partnerId: string;
  range: { from: string; to: string };
  currency: { id: string; code: string } | null;
  partnership: PartnershipState;
  periods: StatementPeriodRow[];
  totals: {
    /** OPEN + UNDER_REVIEW entitlements — provisional (تقديري). */
    estimated: number;
    /** CLOSED periods — approved (معتمد). */
    approvedDue: number;
    paid: number;
    remaining: number;
  };
  adjustments: StatementAdjustmentRow[];
  /** All-time position: approved, paid, still payable, paid in advance. */
  position: {
    approved: number;
    paid: number;
    payable: number;
    advance: number;
  };
}

const SAVED_PERIOD_INCLUDE = (partnerId: string) =>
  ({
    entitlements: { where: { partnerId } },
    adjustments: {
      where: { entitlements: { some: { partnerId } } },
      orderBy: { createdAt: 'asc' },
      include: { entitlements: { where: { partnerId } } },
    },
  }) satisfies Prisma.PartnerProfitPeriodInclude;

type SavedPeriod = Prisma.PartnerProfitPeriodGetPayload<{
  include: ReturnType<typeof SAVED_PERIOD_INCLUDE>;
}>;

const sum = (rows: Array<{ amount: Prisma.Decimal }>) =>
  round2HalfUp(rows.reduce((s, r) => s.add(r.amount), new Prisma.Decimal(0)));

function segmentView(segment: PartnerSegment): StatementSegment {
  return {
    from: segment.from,
    to: segment.to,
    days: segment.days,
    percent: segment.percent,
    basis: segment.basis,
    profitBase: profitBaseLines(segment.figures, segment.basis),
    baseAmount: segment.baseAmount,
    lossClamped: segment.lossClamped,
    amount: segment.amount,
  };
}

/**
 * R14 W5 (spec-5 §6) + R15 W4 (spec-w4 §5) — a partner's statement.
 *
 * Per-period rows: every closing period that overlaps the range — also one
 * only partly inside it — with its status (open estimate / under review /
 * closed), terms, calculated entitlement, approved amount due (closed only),
 * paid (payments applied to closed periods oldest-first, derived) and
 * remaining; plus the adjustment history. Open periods are recomputed from
 * the ledger by the one profit calculation (`PartnerProfitService.calculate`)
 * — never a second profit formula — and only up to today and within the
 * partner's agreements, so an ended partnership has no estimate after its end.
 */
@Injectable()
export class PartnerStatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partners: CompanyPartnersService,
    private readonly profit: PartnerProfitService,
    private readonly payments: PartnerPaymentsService,
    private readonly balances: PartnerBalancesService,
  ) {}

  /** Agreements in force of one partner (ACTIVE / ENDED), oldest first. */
  private async agreementsOf(partnerId: string) {
    const rows = await this.prisma.partnerAgreement.findMany({
      where: { partnerId, status: { in: IN_FORCE_STATUSES } },
      orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(agreementView);
  }

  /**
   * The statement range: as given, else the year to date — or, once the
   * partnership has ended, the year of its last day (its history stays the
   * natural view).
   */
  resolveRange(
    partnership: PartnershipState,
    fromInput?: string,
    toInput?: string,
  ): { from: string; to: string } {
    const today = businessDateOf(new Date());
    const defaultTo =
      partnership.status === 'ENDED' && partnership.endsOn
        ? partnership.endsOn
        : today;
    const to = toInput ? parseBusinessDate(toInput, 'to') : defaultTo;
    const from = fromInput
      ? parseBusinessDate(fromInput, 'from')
      : `${to.slice(0, 4)}-01-01`;
    return { from, to };
  }

  /** Payments applied to every closed period of the partner, oldest first (D15-15). */
  private async closedAllocation(partnerId: string, paidTotal: number) {
    const closed = await this.prisma.partnerProfitPeriod.findMany({
      where: {
        status: PartnerProfitPeriodStatus.CLOSED,
        entitlements: { some: { partnerId } },
      },
      select: {
        id: true,
        entitlements: { where: { partnerId }, select: { amount: true } },
      },
      orderBy: { periodFrom: 'asc' },
    });
    return allocatePaymentsOldestFirst(
      closed.map((period) => ({
        key: period.id,
        due: sum(period.entitlements),
      })),
      paidTotal,
    );
  }

  private savedRow(
    period: SavedPeriod,
    partnerId: string,
    allocation: ReturnType<typeof allocatePaymentsOldestFirst>,
  ): StatementPeriodRow {
    const closed = period.status === PartnerProfitPeriodStatus.CLOSED;
    const original = sum(
      period.entitlements.filter(
        (e) => e.kind === PartnerEntitlementKind.ORIGINAL,
      ),
    );
    const adjustments = sum(
      period.entitlements.filter(
        (e) => e.kind === PartnerEntitlementKind.ADJUSTMENT,
      ),
    );
    const snapshot = period.snapshot as unknown as PartnerProfitCalculation;
    const own = snapshot.partners.find((p) => p.partnerId === partnerId);
    const applied = allocation.byPeriod.get(period.id);
    const approvedDue = closed
      ? round2HalfUp(new Prisma.Decimal(original).add(adjustments))
      : null;
    return {
      periodId: period.id,
      periodFrom: isoDate(period.periodFrom),
      periodTo: isoDate(period.periodTo),
      frequency: period.frequency,
      status: closed ? 'CLOSED' : 'UNDER_REVIEW',
      segments: (own?.segments ?? []).map(segmentView),
      entitlement: original,
      adjustments: closed ? adjustments : null,
      approvedDue,
      paid: closed ? (applied?.paid ?? 0) : null,
      remaining: closed ? (applied?.remaining ?? approvedDue) : null,
    };
  }

  /**
   * Estimate rows: the closing windows of the partner's agreements inside
   * [from, end] that no saved period of the partner covers. One window per
   * stretch of dates (a window overlapping an earlier accepted one is
   * skipped), each estimated over the whole window.
   */
  private async openRows(
    partnerId: string,
    agreements: ReturnType<typeof agreementView>[],
    range: { from: string; end: string },
    saved: Array<{ periodFrom: string; periodTo: string }>,
  ): Promise<StatementPeriodRow[]> {
    const candidates = new Map<
      string,
      { from: string; to: string; frequency: PartnerFrequencyValue }
    >();
    for (const agreement of agreements) {
      const from = maxDate(range.from, agreement.effectiveFrom);
      const to = minDate(range.end, agreement.effectiveTo ?? range.end);
      if (to < from) continue;
      for (const window of closingWindows(agreement.frequency, from, to)) {
        candidates.set(`${window.from}|${window.to}`, {
          ...window,
          frequency: agreement.frequency,
        });
      }
    }
    const taken = [...saved];
    const windows = [...candidates.values()]
      .sort((a, b) =>
        a.from === b.from ? (a.to > b.to ? -1 : 1) : a.from < b.from ? -1 : 1,
      )
      .filter((window) => {
        const overlaps = taken.some((t) =>
          rangesOverlap(t.periodFrom, t.periodTo, window.from, window.to),
        );
        if (!overlaps) {
          taken.push({ periodFrom: window.from, periodTo: window.to });
        }
        return !overlaps;
      });
    // One window after the other: each estimate runs several income-statement
    // queries, and a long range must not fan out over the connection pool.
    const rows: StatementPeriodRow[] = [];
    for (const window of windows) {
      const calculation = await this.profit.calculate(window.from, window.to, {
        partnerId,
      });
      const own = calculation.partners.find((p) => p.partnerId === partnerId);
      if (!own) continue;
      rows.push({
        periodId: null,
        periodFrom: window.from,
        periodTo: window.to,
        frequency: window.frequency,
        status: 'OPEN',
        segments: own.segments.map(segmentView),
        entitlement: own.amount,
        adjustments: null,
        approvedDue: null,
        paid: null,
        remaining: null,
      });
    }
    return rows;
  }

  /** The per-period statement of one partner — shared by the internal page and the partner portal. */
  async periodStatement(
    partnerId: string,
    fromInput?: string,
    toInput?: string,
  ): Promise<PeriodStatement> {
    const today = businessDateOf(new Date());
    const agreements = await this.agreementsOf(partnerId);
    const partnership = partnershipState(agreements, today);
    const range = this.resolveRange(partnership, fromInput, toInput);
    const position = (await this.balances.forPartners([partnerId])).get(
      partnerId,
    )!;
    const [saved, allocation, currency] = await Promise.all([
      this.prisma.partnerProfitPeriod.findMany({
        where: {
          periodFrom: { lte: dateValue(range.to) },
          periodTo: { gte: dateValue(range.from) },
          entitlements: { some: { partnerId } },
        },
        include: SAVED_PERIOD_INCLUDE(partnerId),
        orderBy: { periodFrom: 'asc' },
      }),
      this.closedAllocation(partnerId, position.paid),
      this.profit.functionalCurrency(),
    ]);
    const savedRows = saved.map((period) =>
      this.savedRow(period, partnerId, allocation),
    );
    const openRows = await this.openRows(
      partnerId,
      agreements,
      { from: range.from, end: minDate(range.to, today) },
      savedRows,
    );
    const periods = [...savedRows, ...openRows].sort((a, b) =>
      a.periodFrom < b.periodFrom ? -1 : a.periodFrom > b.periodFrom ? 1 : 0,
    );
    const total = (pick: (row: StatementPeriodRow) => number | null) =>
      round2HalfUp(
        periods.reduce(
          (s, row) => s.add(pick(row) ?? 0),
          new Prisma.Decimal(0),
        ),
      );
    return {
      partnerId,
      range,
      currency,
      partnership,
      periods,
      totals: {
        estimated: total((row) =>
          row.status === 'CLOSED' ? null : row.entitlement,
        ),
        approvedDue: total((row) => row.approvedDue),
        paid: total((row) => row.paid),
        remaining: total((row) => row.remaining),
      },
      adjustments: saved.flatMap((period) =>
        period.adjustments.map((adjustment) => ({
          adjustmentId: adjustment.id,
          periodId: period.id,
          periodFrom: isoDate(period.periodFrom),
          periodTo: isoDate(period.periodTo),
          date: isoDate(adjustment.entryDate),
          reason: adjustment.reason,
          amount: sum(adjustment.entitlements),
        })),
      ),
      position,
    };
  }

  /** Every reviewed / closed period of the partner (all time, newest first) — no estimate is computed. */
  async savedPeriods(partnerId: string) {
    const position = (await this.balances.forPartners([partnerId])).get(
      partnerId,
    )!;
    const [saved, allocation] = await Promise.all([
      this.prisma.partnerProfitPeriod.findMany({
        where: { entitlements: { some: { partnerId } } },
        include: SAVED_PERIOD_INCLUDE(partnerId),
        orderBy: { periodFrom: 'desc' },
      }),
      this.closedAllocation(partnerId, position.paid),
    ]);
    return saved.map((period) => this.savedRow(period, partnerId, allocation));
  }

  /** One reviewed / closed period as it concerns the partner; 404 when the partner has no share in it. */
  async savedPeriod(partnerId: string, periodId: string) {
    const period = await this.prisma.partnerProfitPeriod.findFirst({
      where: { id: periodId, entitlements: { some: { partnerId } } },
      include: SAVED_PERIOD_INCLUDE(partnerId),
    });
    if (!period) {
      throw new NotFoundException(`Profit period ${periodId} not found`);
    }
    const position = (await this.balances.forPartners([partnerId])).get(
      partnerId,
    )!;
    const allocation = await this.closedAllocation(partnerId, position.paid);
    return {
      ...this.savedRow(period, partnerId, allocation),
      adjustmentHistory: period.adjustments.map((adjustment) => ({
        adjustmentId: adjustment.id,
        date: isoDate(adjustment.entryDate),
        reason: adjustment.reason,
        amount: sum(adjustment.entitlements),
      })),
    };
  }

  /**
   * Internal partner page: the per-period statement plus what only staff
   * see — the live range estimate with its company figures, the payments
   * with their accounts (and journal trace), the login and current terms.
   */
  async statement(partnerId: string, fromInput?: string, toInput?: string) {
    const profile = await this.partners.findOne(partnerId);
    const core = await this.periodStatement(partnerId, fromInput, toInput);
    const { from, to } = core.range;
    const [calculation, payments] = await Promise.all([
      this.profit.calculate(from, to, { partnerId }),
      this.payments.list(partnerId),
    ]);
    const own = calculation.partners.find((p) => p.partnerId === partnerId);
    const inRange = payments.filter((p) => p.date >= from && p.date <= to);
    return {
      ...core,
      partner: {
        partnerId: profile.partnerId,
        name: profile.name,
        partnerNumber: profile.partnerNumber,
        ownershipPercent: profile.ownershipPercent,
        status: profile.status,
      },
      login: profile.login,
      agreements: profile.agreements.filter(
        (a) =>
          a.status !== 'DRAFT' &&
          rangesOverlap(a.effectiveFrom, a.effectiveTo, from, to),
      ),
      currentAgreements: profile.agreements.filter(
        (a) => a.status === 'ACTIVE',
      ),
      /** Live estimate of the whole range — recomputed from the ledger each time. */
      estimate: {
        figures: calculation.figures,
        segments: own?.segments ?? [],
        amount: own?.amount ?? 0,
        computedAt: calculation.computedAt,
        warnings: calculation.warnings,
      },
      payments: inRange,
      paidInRange: round2HalfUp(
        inRange
          .filter((p) => !p.reversedAt)
          .reduce((s, p) => s.add(p.amount), new Prisma.Decimal(0)),
      ),
    };
  }
}
