import { describe, expect, it } from "vitest";
import {
  anyPeriodKpis,
  buildActivityRows,
  buildAttentionQueues,
  percentOf,
  settlePendingFigures,
  settleSalesByPeriod,
  summarizeBankMatching,
  type SalesByPeriod,
} from "./dashboard-data";
import type { SalesPerformanceDashboard } from "@/services/sales-performance-service";

function sales(kpis: Partial<SalesPerformanceDashboard["kpis"]>): SalesPerformanceDashboard {
  return {
    period: "month",
    scope: "ALL",
    kpis: {
      newLeads: 0,
      inProgress: 0,
      followUp: 0,
      dueToday: 0,
      overdue: 0,
      converted: 0,
      orders: 0,
      delivered: 0,
      conversionRate: 0,
      ...kpis,
    },
    ranking: { self: { rank: 1, orders: 0, of: 1 }, leaderboard: [] },
  };
}

describe("buildAttentionQueues", () => {
  it("lists only the queues the user can see, open ones urgent-first then by size", () => {
    const { open, cleared } = buildAttentionQueues(
      { overdue: 2, dueToday: 0 },
      { paymentReview: 702, bank: { unmatched: 1, review: 0 } },
    );
    expect(open.map((q) => q.key)).toEqual(["overdue", "paymentReview", "bankUnmatched"]);
    expect(cleared.map((q) => q.key)).toEqual(["dueToday", "bankReview"]);
  });

  it("omits follow-up queues without sales access and bank queues without bank access", () => {
    const { open, cleared } = buildAttentionQueues(null, { paymentReview: 0, bank: null });
    expect(open).toEqual([]);
    expect(cleared.map((q) => q.key)).toEqual(["paymentReview"]);
  });

  it("returns nothing when nothing loaded", () => {
    expect(buildAttentionQueues(null, null)).toEqual({ open: [], cleared: [] });
  });
});

describe("percentOf", () => {
  it("rounds, clamps and treats an empty total as 0", () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(5, 0)).toBe(0);
    expect(percentOf(12, 10)).toBe(100);
    expect(percentOf(Number.NaN, 10)).toBe(0);
  });
});

describe("buildActivityRows", () => {
  it("scales each measure's bars to its own largest period", () => {
    const byPeriod: SalesByPeriod = {
      today: sales({ newLeads: 5, orders: 0 }),
      week: sales({ newLeads: 20, orders: 10 }),
      month: sales({ newLeads: 40, orders: 40 }),
    };
    const rows = buildActivityRows(byPeriod);
    expect(rows.map((row) => row.key)).toEqual(["newLeads", "converted", "orders", "delivered"]);
    expect(rows[0]).toMatchObject({
      values: { today: 5, week: 20, month: 40 },
      bars: { today: 13, week: 50, month: 100 },
    });
    expect(rows[1].bars).toEqual({ today: 0, week: 0, month: 0 });
    expect(rows[2].bars).toEqual({ today: 0, week: 25, month: 100 });
  });
});

describe("summarizeBankMatching", () => {
  it("derives matched / posted shares and flags an empty ledger", () => {
    const summary = summarizeBankMatching({
      incoming: {
        total: 8,
        matched: 6,
        partiallyMatched: 1,
        unmatched: 1,
        conflicts: 0,
        storeOrderMatches: 5,
        b2bSalesInvoiceMatches: 1,
      },
      outgoing: {
        total: 0,
        supplierPayments: 0,
        expenses: 0,
        unclassified: 0,
        pendingVoucher: 0,
        posted: 0,
        conflicts: 0,
      },
    });
    expect(summary.incoming).toMatchObject({ matchedShare: 75, partial: 1, unmatched: 1 });
    expect(summary.outgoing.postedShare).toBe(0);
    expect(summary.empty).toBe(false);
  });
});

describe("settleSalesByPeriod (partial failure, never zeros)", () => {
  const ok = (
    kpis: Parameters<typeof sales>[0],
  ): PromiseSettledResult<SalesPerformanceDashboard> => ({
    status: "fulfilled",
    value: sales(kpis),
  });
  const bad: PromiseSettledResult<SalesPerformanceDashboard> = {
    status: "rejected",
    reason: new Error("boom"),
  };

  it("keeps the periods that loaded and lists the ones that failed", () => {
    const result = settleSalesByPeriod([ok({ newLeads: 1 }), bad, ok({ newLeads: 9 })]);
    expect(result.failed).toEqual(["week"]);
    expect(Object.keys(result.data)).toEqual(["today", "month"]);
  });

  it("fails the whole panel only when every period failed", () => {
    expect(() => settleSalesByPeriod([bad, bad, bad])).toThrow("boom");
  });

  it("renders a failed period as null (not 0) in the activity rows", () => {
    const { data } = settleSalesByPeriod([ok({ newLeads: 4 }), bad, ok({ newLeads: 8 })]);
    const row = buildActivityRows(data)[0];
    expect(row.values).toEqual({ today: 4, week: null, month: 8 });
    expect(row.bars.week).toBe(0);
  });

  it("serves the follow-up queues from whichever period loaded", () => {
    const { data } = settleSalesByPeriod([ok({ overdue: 3 }), bad, bad]);
    expect(anyPeriodKpis(data)?.overdue).toBe(3);
    expect(anyPeriodKpis(null)).toBeNull();
  });

  it("keeps genuine zeros as zeros", () => {
    const { data } = settleSalesByPeriod([ok({}), ok({}), ok({})]);
    expect(buildActivityRows(data)[0].values).toEqual({ today: 0, week: 0, month: 0 });
  });
});

describe("settlePendingFigures (per-section failure, never zeros)", () => {
  const ok = <T>(value: T): PromiseSettledResult<T> => ({ status: "fulfilled", value });
  const bad = (): PromiseSettledResult<never> => ({ status: "rejected", reason: new Error("x") });

  it("keeps the queue that loaded and lists the one that failed (null, not 0)", () => {
    const figures = settlePendingFigures(bad(), ok({ unmatched: 0, review: 3 }));
    expect(figures.paymentReview).toBeNull();
    expect(figures.bank).toEqual({ unmatched: 0, review: 3 });
    expect(figures.failed).toEqual(["paymentReview"]);
    const queues = buildAttentionQueues(null, figures);
    expect(queues.open.map((q) => q.key)).toEqual(["bankReview"]);
    expect(queues.cleared.map((q) => q.key)).toEqual(["bankUnmatched"]);
  });

  it("fails as a whole only when every requested source failed", () => {
    expect(() => settlePendingFigures(bad(), bad())).toThrow("x");
    expect(() => settlePendingFigures(null, bad())).toThrow("x");
  });

  it("treats a source the user may not see as absent, and genuine zeros as zeros", () => {
    const figures = settlePendingFigures(ok(0), null);
    expect(figures).toEqual({ paymentReview: 0, bank: null, failed: [] });
    expect(settlePendingFigures(null, null).failed).toEqual([]);
  });
});
