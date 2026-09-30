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
 * The sales figures for all three periods at once, so the period switch is
 * instant and the activity panel can compare today / week / month to date.
 */
export async function loadSalesByPeriod(): Promise<SalesByPeriod> {
  const [today, week, month] = await Promise.all(
    SALES_PERIODS.map((period) => salesPerformanceService.dashboard(period)),
  );
  return { today, week, month };
}

export interface PendingFigures {
  paymentReview: number | null;
  bank: { unmatched: number; review: number } | null;
}

/** Payment review queue + bank matching queues, each only when the user may see it. */
export async function loadPendingFigures(
  showPaymentReview: boolean,
  showBank: boolean,
): Promise<PendingFigures> {
  const [pending, matched, bankCounts] = await Promise.all([
    showPaymentReview
      ? paymentsReviewService.list({ status: "PENDING", page: 1, pageSize: 1 })
      : null,
    showPaymentReview
      ? paymentsReviewService.list({ status: "MATCHED", page: 1, pageSize: 1 })
      : null,
    showBank ? bankTransactionsService.statusCounts() : null,
  ]);
  return {
    // The review queue's default view is exactly PENDING + MATCHED.
    paymentReview: pending && matched ? pending.total + matched.total : null,
    bank: bankCounts
      ? {
          unmatched: bankCounts.UNMATCHED ?? 0,
          review:
            (bankCounts.MANUAL_REVIEW ?? 0) +
            (bankCounts.CONFLICT ?? 0) +
            (bankCounts.POTENTIAL ?? 0),
        }
      : null,
  };
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
  values: Record<SalesPeriod, number>;
  /** Bar length per period, relative to the row's largest figure. */
  bars: Record<SalesPeriod, number>;
}

const ACTIVITY_KEYS: ActivityKey[] = ["newLeads", "converted", "orders", "delivered"];

/** Today / this week / this month to date, per measure, with comparable bar lengths. */
export function buildActivityRows(byPeriod: SalesByPeriod): ActivityRow[] {
  return ACTIVITY_KEYS.map((key) => {
    const values = {
      today: byPeriod.today.kpis[key],
      week: byPeriod.week.kpis[key],
      month: byPeriod.month.kpis[key],
    };
    const max = Math.max(values.today, values.week, values.month);
    return {
      key,
      values,
      bars: {
        today: percentOf(values.today, max),
        week: percentOf(values.week, max),
        month: percentOf(values.month, max),
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
