import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { SalesPerformanceDashboard } from "@/services/sales-performance-service";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params ? `${key}${JSON.stringify(params)}` : key,
    locale: "en",
    direction: "ltr",
  }),
}));

vi.mock("@/providers/user-context", () => ({
  useUserContext: () => ({ user: { id: "u-self" } }),
}));

const own: SalesPerformanceDashboard = {
  period: "month",
  scope: "OWN",
  kpis: {
    newLeads: 1,
    inProgress: 0,
    followUp: 0,
    dueToday: 0,
    overdue: 0,
    converted: 0,
    orders: 3,
    delivered: 1,
    conversionRate: 0,
  },
  ranking: { self: { rank: 3, orders: 3, of: 12 }, leaderboard: [] },
};

vi.mock("@/components/dashboard/dashboard-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/dashboard/dashboard-data")>()),
  loadSalesByPeriod: () =>
    Promise.resolve({ data: { today: own, week: own, month: own }, failed: [] }),
  loadPendingFigures: () => Promise.resolve({ paymentReview: null, bank: null, failed: [] }),
}));

import { DashboardOverview } from "./dashboard-overview";

describe("DashboardOverview — a salesperson's ranking panel (R15 D15-18)", () => {
  afterEach(cleanup);

  it("OWN scope keeps the ranking panel and shows the own rank, never a colleague", async () => {
    const { container } = render(
      <DashboardOverview
        access={{ sales: true, leads: true, orders: true, paymentReview: false, bank: false }}
      />,
    );
    await waitFor(() =>
      expect(container.textContent).toContain('salesVisibility.rankOf{"position":3,"of":12}'),
    );
    expect(container.textContent).toContain("crm.leads.dashboard.ranking");
  });
});
