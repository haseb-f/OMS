import { Prisma } from '@prisma/client';
import {
  addCalendarDays,
  calendarDaysBetween,
} from '../common/time/business-date';

/**
 * R14 W5 (spec-5 §3-4) — the pure part of company-partner profit sharing:
 * segments, loss rule, rounding, the Σ% rule and period windows. No I/O —
 * the service feeds it agreements and income-statement figures, so every
 * rule is unit-testable on its own.
 */

export type PartnerProfitBasisValue = 'GROSS_PROFIT' | 'NET_PROFIT';
export type PartnerFrequencyValue = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

/** An agreement in force (ACTIVE or ENDED) over [effectiveFrom, effectiveTo]. */
export interface AgreementInForce {
  id: string;
  partnerId: string;
  percent: number;
  basis: PartnerProfitBasisValue;
  /** "YYYY-MM-DD", inclusive. */
  effectiveFrom: string;
  /** "YYYY-MM-DD", inclusive; null = open-ended. */
  effectiveTo: string | null;
  frequency: PartnerFrequencyValue;
}

/** Income-statement figures of one date range (functional currency). */
export interface ProfitFigures {
  netRevenue: number;
  costOfSales: number;
  grossProfit: number;
  /** Everything between gross and net profit (selling, admin, other, FX, finance, net of other income). */
  otherExpensesNet: number;
  netProfit: number;
}

export interface PartnerSegment {
  agreementId: string;
  partnerId: string;
  basis: PartnerProfitBasisValue;
  percent: number;
  from: string;
  to: string;
  days: number;
  figures: ProfitFigures;
  /** Profit of the segment on the agreement's basis (may be ≤ 0). */
  baseAmount: number;
  /** Loss rule: a segment whose base is ≤ 0 yields 0 (no carry-forward, D5-1). */
  lossClamped: boolean;
  /** Rounded share of this segment; the segments of a partner add up to `PartnerResult.amount`. */
  amount: number;
}

export interface PartnerResult {
  partnerId: string;
  segments: PartnerSegment[];
  /** Σ segment base × percent, rounded once per partner (2 dp, half-up). */
  amount: number;
}

const ROUND = Prisma.Decimal.ROUND_HALF_UP;

/** 2 decimals, half-up, on the exact decimal value (no binary float drift). */
export function round2HalfUp(value: Prisma.Decimal.Value): number {
  return new Prisma.Decimal(value).toDecimalPlaces(2, ROUND).toNumber();
}

export function maxDate(a: string, b: string) {
  return a >= b ? a : b;
}
export function minDate(a: string, b: string) {
  return a <= b ? a : b;
}

/** Inclusive overlap of two date ranges (null end = open-ended). */
export function rangesOverlap(
  aFrom: string,
  aTo: string | null,
  bFrom: string,
  bTo: string | null,
): boolean {
  return (aTo === null || bFrom <= aTo) && (bTo === null || aFrom <= bTo);
}

/**
 * Segments of one partner inside [from, to]: one per agreement in force,
 * clipped to the period — the period is split by THIS partner's agreement
 * dates only, so another partner's change never moves this partner's base.
 */
export function partnerWindows(
  agreements: AgreementInForce[],
  from: string,
  to: string,
): Array<{ agreement: AgreementInForce; from: string; to: string }> {
  return agreements
    .filter((a) => rangesOverlap(a.effectiveFrom, a.effectiveTo, from, to))
    .map((agreement) => ({
      agreement,
      from: maxDate(from, agreement.effectiveFrom),
      to: minDate(to, agreement.effectiveTo ?? to),
    }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/** The share of one partner: Σ segment base × percent with the loss rule, rounded once. */
export function computePartnerResult(
  partnerId: string,
  windows: Array<{
    agreement: AgreementInForce;
    from: string;
    to: string;
    figures: ProfitFigures;
  }>,
): PartnerResult {
  const exact = windows.map(({ agreement, figures }) => {
    const base =
      agreement.basis === 'GROSS_PROFIT'
        ? figures.grossProfit
        : figures.netProfit;
    const clamped = base <= 0;
    return {
      base,
      clamped,
      share: clamped
        ? new Prisma.Decimal(0)
        : new Prisma.Decimal(base).mul(agreement.percent).div(100),
    };
  });
  const total = exact.reduce(
    (sum, row) => sum.add(row.share),
    new Prisma.Decimal(0),
  );
  const amount = round2HalfUp(total);
  const segments: PartnerSegment[] = windows.map((window, index) => ({
    agreementId: window.agreement.id,
    partnerId,
    basis: window.agreement.basis,
    percent: window.agreement.percent,
    from: window.from,
    to: window.to,
    days: calendarDaysBetween(window.from, window.to) + 1,
    figures: window.figures,
    baseAmount: round2HalfUp(exact[index].base),
    lossClamped: exact[index].clamped,
    amount: round2HalfUp(exact[index].share),
  }));
  // Per-partner rounding is authoritative: any cent of difference from
  // rounding each segment lands on the last segment that earned something.
  const residual = round2HalfUp(
    new Prisma.Decimal(amount).sub(
      segments.reduce(
        (sum, segment) => sum.add(segment.amount),
        new Prisma.Decimal(0),
      ),
    ),
  );
  if (residual !== 0) {
    const target = [...segments].reverse().find((s) => !s.lossClamped);
    if (target) target.amount = round2HalfUp(target.amount + residual);
  }
  return { partnerId, segments, amount };
}

/**
 * Highest Σ percent of agreements in force on any single day (sweep over
 * start / day-after-end events). Used for the "one company pool ≤ 100 %" rule.
 */
export function maxConcurrentPercent(
  intervals: Array<{ from: string; to: string | null; percent: number }>,
): { max: number; on: string | null } {
  const events: Array<{ date: string; delta: Prisma.Decimal }> = [];
  for (const interval of intervals) {
    events.push({
      date: interval.from,
      delta: new Prisma.Decimal(interval.percent),
    });
    if (interval.to !== null) {
      events.push({
        date: addCalendarDays(interval.to, 1),
        delta: new Prisma.Decimal(interval.percent).neg(),
      });
    }
  }
  // Same day: endings (negative) before starts, so back-to-back agreements never add up.
  events.sort((a, b) =>
    a.date === b.date ? a.delta.cmp(b.delta) : a.date < b.date ? -1 : 1,
  );
  let running = new Prisma.Decimal(0);
  let max = new Prisma.Decimal(0);
  let on: string | null = null;
  for (const event of events) {
    running = running.add(event.delta);
    if (running.gt(max)) {
      max = running;
      on = event.date;
    }
  }
  return { max: max.toNumber(), on };
}

/** The closing window a frequency allows for a start date, or null when the start is not a window start. */
export function frequencyWindow(
  frequency: PartnerFrequencyValue,
  from: string,
): { from: string; to: string } | null {
  const [y, m, d] = from.split('-').map(Number);
  if (d !== 1) return null;
  const months =
    frequency === 'MONTHLY' ? 1 : frequency === 'QUARTERLY' ? 3 : 12;
  if (frequency === 'QUARTERLY' && (m - 1) % 3 !== 0) return null;
  if (frequency === 'ANNUAL' && m !== 1) return null;
  const end = new Date(Date.UTC(y, m - 1 + months, 0));
  const to = `${String(end.getUTCFullYear()).padStart(4, '0')}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`;
  return { from, to };
}

const WINDOW_MONTHS: Record<PartnerFrequencyValue, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  ANNUAL: 12,
};

/**
 * R15 (spec-w4 §5) — every closing window of `frequency` that overlaps the
 * inclusive range [from, to], oldest first. A window only partly inside the
 * range is included whole (a period is reported as the period it is).
 */
export function closingWindows(
  frequency: PartnerFrequencyValue,
  from: string,
  to: string,
): Array<{ from: string; to: string }> {
  if (to < from) return [];
  const months = WINDOW_MONTHS[frequency];
  const [year, month] = from.split('-').map(Number);
  // Index of the first month of the window that contains `from`.
  let index = year * 12 + (month - 1);
  index -= index % months;
  const windows: Array<{ from: string; to: string }> = [];
  for (;;) {
    const start = `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}-01`;
    if (start > to) break;
    windows.push(frequencyWindow(frequency, start)!);
    index += months;
  }
  return windows;
}

/** "YYYY-MM-DD" of a `@db.Date` value (stored at 00:00Z). */
export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** `@db.Date` value of a "YYYY-MM-DD" business date. */
export function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
