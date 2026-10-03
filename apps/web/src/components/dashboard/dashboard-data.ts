"use client";

import { useCallback, useEffect, useState } from "react";
import { paymentsReviewService } from "@/services/payments-review-service";
import {
  bankTransactionsService,
  type CashFlowSummary,
} from "@/services/bank-transactions-service";
import {
  salesPerformanceService,
  type SalesPerformanceDashboard,
  type SalesPeriod,
} from "@/services/sales-performance-service";

export type LoadState<T> =
  { status: "loading" } | { status: "error" } | { status: "ready"; data: T };

/** One async figure set with an explicit error state (never a silent "—") and retry. */
export function useLoad<T>(loader: () => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", data: await loader() });
    } catch {
      setState({ status: "error" });
    }
  }, [loader]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  return { state, retry: load };
}

export const SALES_PERIODS = ["today", "week", "month"] as const satisfies readonly SalesPeriod[];

export type SalesByPeriod = Record<SalesPeriod, SalesPerformanceDashboard>;

/**
 * What the three period requests produced. A period that failed is listed in
 * `failed` and absent from `data` — never defaulted to zeros — so one slow or
 * failing request degrades only the sub-panel that needs it (Round 7).
 */
export interface SalesByPeriodResult {
  data: Partial<SalesByPeriod>;
  failed: SalesPeriod[];
}

/** Pure: folds the settled period requests; all three failing is a whole-panel failure (throws). */
export function settleSalesByPeriod(
  results: readonly PromiseSettledResult<SalesPerformanceDashboard>[],
): SalesByPeriodResult {
  const data: Partial<SalesByPeriod> = {};
  const failed: SalesPeriod[] = [];
  SALES_PERIODS.forEach((period, index) => {
    const result = results[index];
    if (result?.status === "fulfilled") data[period] = result.value;
    else failed.push(period);
  });
  if (failed.length === SALES_PERIODS.length) {
    const first = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw first?.reason ?? new Error("sales performance unavailable");
  }
  return { data, failed };
}

/**
 * The sales figures for all three periods at once, so the period switch is
 * instant and the activity panel can compare today / week / month to date.
 */
export async function loadSalesByPeriod(): Promise<SalesByPeriodResult> {
  return settleSalesByPeriod(
    await Promise.allSettled(
      SALES_PERIODS.map((period) => salesPerformanceService.dashboard(period)),
    ),
  );
}

/** Follow-up queues are not period-bound, so whichever period loaded serves. */
export function anyPeriodKpis(
  data: Partial<SalesByPeriod> | null,
): SalesPerformanceDashboard["kpis"] | null {
  if (!data) return null;
  return (data.month ?? data.week ?? data.today)?.kpis ?? null;
}

export interface PendingFigures {
  paymentReview: number | null;
  bank: { unmatched: number; review: number } | null;
  /** Sources that failed to load — absent from the figures above, never defaulted to 0. */
  failed: ("paymentReview" | "bank")[];
}

/** Pure: folds the settled queue requests; every requested source failing is a whole failure (throws). */
export function settlePendingFigures(
  paymentReview: PromiseSettledResult<number> | null,
  bank: PromiseSettledResult<{ unmatched: number; review: number }> | null,
): PendingFigures {
  const failed: PendingFigures["failed"] = [];
  if (paymentReview?.status === "rejected") failed.push("paymentReview");
  if (bank?.status === "rejected") failed.push("bank");
  const requested = Number(paymentReview !== null) + Number(bank !== null);
  if (requested > 0 && failed.length === requested) {
    const first = [paymentReview, bank].find(
      (r): r is PromiseRejectedResult => r?.status === "rejected",
    );
    throw first?.reason ?? new Error("queues unavailable");
  }
  return {
    paymentReview: paymentReview?.status === "fulfilled" ? paymentReview.value : null,
    bank: bank?.status === "fulfilled" ? bank.value : null,
    failed,
  };
}

/**
 * Payment review queue + bank matching queues, each only when the user may
 * see it — and each failing on its own (Round 7), so one slow endpoint never
 * blanks the other queue.
 */
export async function loadPendingFigures(
  showPaymentReview: boolean,
  showBank: boolean,
): Promise<PendingFigures> {
  const [paymentReview, bank] = await Promise.all([
    showPaymentReview
      ? Promise.allSettled([
          paymentsReviewService.list({ status: "PENDING", page: 1, pageSize: 1 }),
          paymentsReviewService.list({ status: "MATCHED", page: 1, pageSize: 1 }),
        ]).then(([pending, matched]): PromiseSettledResult<number> => {
          if (pending.status === "rejected") return pending;
          if (matched.status === "rejected") return matched;
          // The review queue's default view is exactly PENDING + MATCHED.
          return { status: "fulfilled", value: pending.value.total + matched.value.total };
        })
      : null,
    showBank
      ? Promise.allSettled([bankTransactionsService.statusCounts()]).then(
          ([counts]): PromiseSettledResult<{ unmatched: number; review: number }> =>
            counts.status === "rejected"
              ? counts
              : {
                  status: "fulfilled",
                  value: {
                    unmatched: counts.value.UNMATCHED ?? 0,
                    review:
                      (counts.value.MANUAL_REVIEW ?? 0) +
                      (counts.value.CONFLICT ?? 0) +
                      (counts.value.POTENTIAL ?? 0),
                  },
                },
        )
      : null,
  ]);
  return settlePendingFigures(paymentReview, bank);
}

/**
 * The bank matching panel's summary — loaded on its own so that a failure of
 * this heavier call never hides the attention queues (and vice versa).
 */
export function loadBankMatchingSummary(): Promise<CashFlowSummary> {
  return bankTransactionsService.cashFlowSummary();
}

// ── Pure shaping (unit-tested in dashboard-data.spec.ts) ───────────────────

export type AttentionKey =
  "overdue" | "dueToday" | "paymentReview" | "bankReview" | "bankUnmatched";

export interface AttentionQueue {
  key: AttentionKey;
  count: number;
  severity: "destructive" | "warning";
  href: string;
}

/**
 * The open work queues the user can see: open ones most urgent first
 * (overdue before warnings, then by size); empty ones listed separately as
 * "clear" rather than hidden.
 */
export function buildAttentionQueues(
  kpis: Pick<SalesPerformanceDashboard["kpis"], "overdue" | "dueToday"> | null,
  pending: Pick<PendingFigures, "paymentReview" | "bank"> | null,
): { open: AttentionQueue[]; cleared: AttentionQueue[] } {
  const queues: AttentionQueue[] = [];
  if (kpis) {
    queues.push(
      {
        key: "overdue",
        count: kpis.overdue,
        severity: "destructive",
        href: "/crm/leads?followUp=overdue",
      },
      {
        key: "dueToday",
        count: kpis.dueToday,
        severity: "warning",
        href: "/crm/leads?followUp=today",
      },
    );
  }
  if (pending?.paymentReview != null) {
    queues.push({
      key: "paymentReview",
      count: pending.paymentReview,
      severity: "warning",
      href: "/finance/payment-review",
    });
  }
  if (pending?.bank) {
    queues.push(
      {
        key: "bankReview",
        count: pending.bank.review,
        severity: "warning",
        href: "/finance/bank-transactions",
      },
      {
        key: "bankUnmatched",
        count: pending.bank.unmatched,
        severity: "warning",
        href: "/finance/bank-transactions",
      },
    );
  }
  const rank = (queue: AttentionQueue) => (queue.severity === "destructive" ? 0 : 1);
  return {
    open: queues
      .filter((queue) => queue.count > 0)
      .sort((a, b) => rank(a) - rank(b) || b.count - a.count),
    cleared: queues.filter((queue) => queue.count <= 0),
  };
}

/** Share of `value` in `total` as a whole percentage (0 when there is no total). */
export function percentOf(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

export type ActivityKey = "newLeads" | "converted" | "orders" | "delivered";

export interface ActivityRow {
  key: ActivityKey;
  /** `null` = that period failed to load (shown as "—", never as 0). */
  values: Record<SalesPeriod, number | null>;
  /** Bar length per period, relative to the row's largest figure. */
  bars: Record<SalesPeriod, number>;
}

const ACTIVITY_KEYS: ActivityKey[] = ["newLeads", "converted", "orders", "delivered"];

/** Today / this week / this month to date, per measure, with comparable bar lengths. */
export function buildActivityRows(byPeriod: Partial<SalesByPeriod>): ActivityRow[] {
  return ACTIVITY_KEYS.map((key) => {
    const values: Record<SalesPeriod, number | null> = {
      today: byPeriod.today?.kpis[key] ?? null,
      week: byPeriod.week?.kpis[key] ?? null,
      month: byPeriod.month?.kpis[key] ?? null,
    };
    const max = Math.max(values.today ?? 0, values.week ?? 0, values.month ?? 0);
    return {
      key,
      values,
      bars: {
        today: percentOf(values.today ?? 0, max),
        week: percentOf(values.week ?? 0, max),
        month: percentOf(values.month ?? 0, max),
      },
    };
  });
}

export interface BankMatchingSummary {
  incoming: {
    total: number;
    matched: number;
    partial: number;
    unmatched: number;
    conflicts: number;
    matchedShare: number;
  };
  outgoing: {
    total: number;
    posted: number;
    pendingVoucher: number;
    unclassified: number;
    conflicts: number;
    postedShare: number;
  };
  empty: boolean;
}

/** Matching progress of every bank transaction, incoming and outgoing. */
export function summarizeBankMatching(summary: CashFlowSummary): BankMatchingSummary {
  const { incoming, outgoing } = summary;
  return {
    incoming: {
      total: incoming.total,
      matched: incoming.matched,
      partial: incoming.partiallyMatched,
      unmatched: incoming.unmatched,
      conflicts: incoming.conflicts,
      matchedShare: percentOf(incoming.matched, incoming.total),
    },
    outgoing: {
      total: outgoing.total,
      posted: outgoing.posted,
      pendingVoucher: outgoing.pendingVoucher,
      unclassified: outgoing.unclassified,
      conflicts: outgoing.conflicts,
      postedShare: percentOf(outgoing.posted, outgoing.total),
    },
    empty: incoming.total + outgoing.total === 0,
  };
}
