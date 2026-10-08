import { Prisma } from '@prisma/client';
import {
  type PartnerProfitBasisValue,
  type ProfitFigures,
  round2HalfUp,
} from './partner-profit-calculator';

/**
 * R15 (spec-w4 §4-5, D15-14, D15-15) — the pure rules of the per-period
 * partner statement, shared by the internal partner page and the partner
 * portal. No I/O: the statement service feeds them stored rows.
 */

/** Closing status of one statement row. */
export type StatementPeriodStatus = 'OPEN' | 'UNDER_REVIEW' | 'CLOSED';

export interface PeriodDue {
  key: string;
  /** Approved amount due of a CLOSED period (original + adjustments). */
  due: number;
}

export interface PeriodAllocation {
  paid: number;
  remaining: number;
}

/**
 * D15-15 — payments are applied to closed periods oldest-first. Derived on
 * every read, never stored: `periods` must be in period order and hold every
 * closed period of the partner (all time), `paidTotal` every non-reversed
 * payment. Anything paid beyond the approved total is an advance
 * (`unallocated`), netted against later approved periods automatically.
 */
export function allocatePaymentsOldestFirst(
  periods: PeriodDue[],
  paidTotal: number,
): { byPeriod: Map<string, PeriodAllocation>; unallocated: number } {
  let left = new Prisma.Decimal(paidTotal);
  const byPeriod = new Map<string, PeriodAllocation>();
  for (const period of periods) {
    const due = new Prisma.Decimal(period.due);
    const applied = Prisma.Decimal.max(0, Prisma.Decimal.min(due, left));
    left = left.sub(applied);
    byPeriod.set(period.key, {
      paid: round2HalfUp(applied),
      remaining: round2HalfUp(due.sub(applied)),
    });
  }
  return { byPeriod, unallocated: round2HalfUp(Prisma.Decimal.max(0, left)) };
}

export type PartnershipStatus =
  'NO_AGREEMENT' | 'NOT_STARTED' | 'ACTIVE' | 'ENDED';

export interface PartnershipState {
  status: PartnershipStatus;
  /** First day of the first agreement in force. */
  startedOn: string | null;
  /** Last day of the last agreement; null while an agreement is open-ended. */
  endsOn: string | null;
}

/**
 * Expiry (4.7, D15-14): the partnership spans the agreements in force
 * (ACTIVE / ENDED — a DRAFT never counts). After the last agreement's end
 * date it is ENDED: nothing is erased, the history stays readable, and no
 * estimate exists for dates after the end.
 */
export function partnershipState(
  agreements: Array<{ effectiveFrom: string; effectiveTo: string | null }>,
  today: string,
): PartnershipState {
  if (agreements.length === 0) {
    return { status: 'NO_AGREEMENT', startedOn: null, endsOn: null };
  }
  const startedOn = agreements
    .map((a) => a.effectiveFrom)
    .reduce((a, b) => (a <= b ? a : b));
  const endsOn = agreements.some((a) => a.effectiveTo === null)
    ? null
    : agreements
        .map((a) => a.effectiveTo as string)
        .reduce((a, b) => (a >= b ? a : b));
  const status: PartnershipStatus =
    today < startedOn
      ? 'NOT_STARTED'
      : endsOn !== null && today > endsOn
        ? 'ENDED'
        : 'ACTIVE';
  return { status, startedOn, endsOn };
}

/**
 * The company figures a partner may see for one segment: only the lines its
 * agreement's basis uses (4.11). Gross basis → net revenue, cost of sales,
 * gross profit. Net basis → those plus the net of every other expense and
 * income line, and net profit. Nothing below that (no account, no line item).
 */
export interface ProfitBaseLines {
  netRevenue: number;
  costOfSales: number;
  /** Net basis only — expenses and other items between gross and net profit. */
  otherExpensesNet: number | null;
  /** The profit the share was computed on (gross or net). */
  profit: number;
}

export function profitBaseLines(
  figures: ProfitFigures,
  basis: PartnerProfitBasisValue,
): ProfitBaseLines {
  return basis === 'GROSS_PROFIT'
    ? {
        netRevenue: figures.netRevenue,
        costOfSales: figures.costOfSales,
        otherExpensesNet: null,
        profit: figures.grossProfit,
      }
    : {
        netRevenue: figures.netRevenue,
        costOfSales: figures.costOfSales,
        otherExpensesNet: figures.otherExpensesNet,
        profit: figures.netProfit,
      };
}
