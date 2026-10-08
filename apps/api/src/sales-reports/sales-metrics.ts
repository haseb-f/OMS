import { Prisma } from '@prisma/client';
import {
  addCalendarDays,
  businessDayEndExclusive,
  businessDayStart,
  todayBusinessDate,
  toBusinessDateString,
  calendarDaysBetween,
  BUSINESS_TIME_ZONE,
} from '../common/time/business-date';

/**
 * R13 spec E — the ONE definition of every sales-report metric. The Live
 * cards, the employee / team ranking, the comparison chart, the payment mix
 * and the agent-portal copies all read these constants, SQL fragments and
 * pure functions; no report computes a figure its own way.
 *
 * - Sales order   — a `StoreOrder` with `deletedAt = null`, placed in the
 *                   business calendar (Africa/Cairo) by `orderDate`.
 * - Valid order   — fulfillment status code ≠ CANCELLED. Cancelled orders are
 *                   counted separately and never enter an amount or a rank.
 * - Returned      — fulfillment status RETURNED: still a sale (counted in
 *                   orders and valid, amount included) and shown separately.
 *                   Refunds are finance, not deducted here.
 * - Sales amount  — `payableTotal`, or Σ live item `agreedAmount` for legacy
 *                   orders without one (`storeOrderPayableTotal`), per ORDER
 *                   currency. Currencies are never added together.
 * - Owner         — the current `employeeId`; agent orders by `agentId`.
 * - Collections (verified payments) are not a sales metric.
 */

export const CANCELLED_STATUS = 'CANCELLED';
export const RETURNED_STATUS = 'RETURNED';
export const DELIVERED_STATUS = 'DELIVERED';

/**
 * Fulfillment status code of an order. Orders created before the status
 * definitions existed carry only the dual-written `shippingStage`; they map
 * to the code that stage is written with today (NOT_READY → UNFULFILLED,
 * READY_FOR_SHIPPING → READY), so no order is left without a status.
 */
export function fulfillmentCodeOf(
  statusCode: string | null | undefined,
  shippingStage: string | null | undefined,
): string {
  if (statusCode) return statusCode;
  return shippingStage === 'READY_FOR_SHIPPING' ? 'READY' : 'UNFULFILLED';
}

/** SQL twin of `fulfillmentCodeOf` (aliases: `o` = store_orders, `sd` = status_definitions). */
export const ORDER_STATUS_CODE_SQL = Prisma.sql`COALESCE(sd.code, CASE WHEN o.shipping_stage::text = 'READY_FOR_SHIPPING' THEN 'READY' ELSE 'UNFULFILLED' END)`;

/** SQL twin of `storeOrderPayableTotal` — payable total, else Σ live line agreed amounts. */
export const ORDER_AMOUNT_SQL = Prisma.sql`COALESCE(o.payable_total, (SELECT SUM(i.agreed_amount) FROM store_order_items i WHERE i.store_order_id = o.id AND i.deleted_at IS NULL), 0)`;

export function isValidOrder(statusCode: string): boolean {
  return statusCode !== CANCELLED_STATUS;
}

export function isCancelledOrder(statusCode: string): boolean {
  return statusCode === CANCELLED_STATUS;
}

export function isReturnedOrder(statusCode: string): boolean {
  return statusCode === RETURNED_STATUS;
}

// ---------------------------------------------------------------------------
// Periods (Africa/Cairo business calendar)
// ---------------------------------------------------------------------------

export const LIVE_PERIODS = [
  'today',
  'yesterday',
  'last7Days',
  'thisMonth',
  'lastMonth',
] as const;
export type LivePeriod = (typeof LIVE_PERIODS)[number];

export interface PeriodRange {
  /** Inclusive business dates ("YYYY-MM-DD"). */
  from: string;
  to: string;
  /** UTC query bounds: `orderDate >= start AND orderDate < endExclusive`. */
  start: Date;
  endExclusive: Date;
}

export interface LivePeriodRange extends PeriodRange {
  period: LivePeriod;
}

/** Inclusive business-date range as UTC bounds. */
export function periodRange(from: string, to: string): PeriodRange {
  const f = toBusinessDateString(from);
  const t = toBusinessDateString(to);
  return {
    from: f,
    to: t,
    start: businessDayStart(f),
    endExclusive: businessDayEndExclusive(t),
  };
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/**
 * The five Live periods for `now`: Today; Yesterday; Last 7 days = today and
 * the 6 previous days; This month = the 1st → today; Last month = the full
 * previous calendar month. All in the Cairo business calendar.
 */
export function livePeriodRanges(now: Date = new Date()): LivePeriodRange[] {
  const today = todayBusinessDate(now, BUSINESS_TIME_ZONE);
  const yesterday = addCalendarDays(today, -1);
  const thisMonthStart = monthStart(today);
  const lastMonthEnd = addCalendarDays(thisMonthStart, -1);
  const lastMonthStart = monthStart(lastMonthEnd);
  const spans: Array<[LivePeriod, string, string]> = [
    ['today', today, today],
    ['yesterday', yesterday, yesterday],
    ['last7Days', addCalendarDays(today, -6), today],
    ['thisMonth', thisMonthStart, today],
    ['lastMonth', lastMonthStart, lastMonthEnd],
  ];
  return spans.map(([period, from, to]) => ({
    period,
    ...periodRange(from, to),
  }));
}

/** The home dashboard's period switch (`GET /sales/performance?period=`). */
export const DASHBOARD_PERIODS = ['today', 'week', 'month'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

/**
 * Dashboard period to date in the same Cairo business calendar as the
 * reports: Today = the Live "today" card, This month = the Live "this month"
 * card, This week = Monday → today.
 */
export function dashboardPeriodRange(
  period: DashboardPeriod,
  now: Date = new Date(),
): PeriodRange {
  const today = todayBusinessDate(now, BUSINESS_TIME_ZONE);
  if (period === 'today') return periodRange(today, today);
  if (period === 'month') return periodRange(monthStart(today), today);
  // getUTCDay of the calendar date itself: 0 = Sunday … 6 = Saturday.
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return periodRange(addCalendarDays(today, -((weekday + 6) % 7)), today);
}

/** Longest custom range the performance report accepts (inclusive days). */
export const MAX_REPORT_RANGE_DAYS = 366;

/** Whole inclusive days of a range ("2026-10-01".."2026-10-01" → 1). */
export function rangeDays(from: string, to: string): number {
  return calendarDaysBetween(from, to) + 1;
}

/** Default performance range: this month to date. */
export function defaultPerformanceRange(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const today = todayBusinessDate(now, BUSINESS_TIME_ZONE);
  return { from: monthStart(today), to: today };
}

// ---------------------------------------------------------------------------
// Accumulation
// ---------------------------------------------------------------------------

export interface CurrencyAmount {
  currencyCode: string;
  amount: number;
}

export interface SalesStats {
  orders: number;
  valid: number;
  cancelled: number;
  returned: number;
  /** Valid-order sales amount per order currency (never summed across). */
  amounts: CurrencyAmount[];
}

/** One grouped row: `count` orders of one status code in one currency. */
export interface GroupedOrders {
  statusCode: string;
  currencyCode: string;
  count: number;
  /** Σ order amount of those orders (Decimal / numeric string from SQL). */
  amount: Prisma.Decimal | string | number | null;
}

function toDecimal(value: GroupedOrders['amount']): Prisma.Decimal {
  if (value == null || value === '') return new Prisma.Decimal(0);
  return new Prisma.Decimal(value);
}

/** Money rounded to 2 dp for the response. */
export function roundAmount(value: Prisma.Decimal): number {
  return Number(value.toDecimalPlaces(2).toFixed(2));
}

/**
 * Folds grouped rows into the core stats. Amounts are exact decimals per
 * currency; a cancelled row adds to `cancelled` and never to an amount.
 */
export class SalesTally {
  orders = 0;
  valid = 0;
  cancelled = 0;
  returned = 0;
  private readonly amountByCurrency = new Map<string, Prisma.Decimal>();
  private readonly countByStatus = new Map<string, number>();

  add(row: GroupedOrders): this {
    const count = Number(row.count);
    this.orders += count;
    this.countByStatus.set(
      row.statusCode,
      (this.countByStatus.get(row.statusCode) ?? 0) + count,
    );
    if (isCancelledOrder(row.statusCode)) {
      this.cancelled += count;
      return this;
    }
    this.valid += count;
    if (isReturnedOrder(row.statusCode)) this.returned += count;
    const current =
      this.amountByCurrency.get(row.currencyCode) ?? new Prisma.Decimal(0);
    this.amountByCurrency.set(
      row.currencyCode,
      current.add(toDecimal(row.amount)),
    );
    return this;
  }

  /** Valid-order amount in one currency (0 when none). */
  amountIn(currencyCode: string): Prisma.Decimal {
    return this.amountByCurrency.get(currencyCode) ?? new Prisma.Decimal(0);
  }

  amounts(): CurrencyAmount[] {
    return [...this.amountByCurrency.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currencyCode, amount]) => ({
        currencyCode,
        amount: roundAmount(amount),
      }));
  }

  /** Orders of one fulfillment status code (0 when none). */
  countOf(statusCode: string): number {
    return this.countByStatus.get(statusCode) ?? 0;
  }

  statusBreakdown(): Array<{ code: string; count: number }> {
    return [...this.countByStatus.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([code, count]) => ({ code, count }));
  }

  stats(): SalesStats {
    return {
      orders: this.orders,
      valid: this.valid,
      cancelled: this.cancelled,
      returned: this.returned,
      amounts: this.amounts(),
    };
  }
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export type RankBy = 'count' | 'amount';

export interface Rankable {
  tally: SalesTally;
  name: string;
}

/**
 * Ranking rule: valid-order count by default; by valid amount only within
 * ONE currency (no conversion — decision O-5). Ties fall back to valid
 * count, then name, so the order is deterministic. Competition ranking
 * (1, 2, 2, 4) on the primary key.
 */
export function rankEntries<T extends Rankable>(
  entries: T[],
  rankBy: RankBy,
  currencyCode?: string | null,
): Array<T & { rank: number; rankValue: number }> {
  if (rankBy === 'amount' && !currencyCode) {
    throw new RangeError('Ranking by amount needs a currency.');
  }
  const primary = (entry: T): Prisma.Decimal =>
    rankBy === 'amount'
      ? entry.tally.amountIn(currencyCode as string)
      : new Prisma.Decimal(entry.tally.valid);
  const sorted = [...entries].sort((a, b) => {
    const byPrimary = primary(b).comparedTo(primary(a));
    if (byPrimary !== 0) return byPrimary;
    if (b.tally.valid !== a.tally.valid) return b.tally.valid - a.tally.valid;
    return a.name.localeCompare(b.name);
  });
  let rank = 0;
  let previous: Prisma.Decimal | null = null;
  return sorted.map((entry, index) => {
    const value = primary(entry);
    if (!previous || !value.equals(previous)) rank = index + 1;
    previous = value;
    return { ...entry, rank, rankValue: roundAmount(value) };
  });
}
