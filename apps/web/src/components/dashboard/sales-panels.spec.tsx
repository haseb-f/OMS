import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

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

import { RankingPanel, SalesOverviewPanel } from "@/components/dashboard/sales-panels";
import type { SalesPerformanceDashboard } from "@/services/sales-performance-service";

const data = {
  kpis: {
    newLeads: 10,
    converted: 4,
    conversionRate: 40,
    orders: 7,
    delivered: 3,
    inProgress: 2,
  },
} as unknown as SalesPerformanceDashboard;

const card = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('[data-slot="insight-card"]')].find((el) =>
    el.textContent?.includes(label),
  );

describe("SalesOverviewPanel — conversion rate card", () => {
  afterEach(cleanup);

  it("behaves like its sibling figures: a real drill-down with focus when the user may open leads", () => {
    const { container } = render(
      <SalesOverviewPanel data={data} period="month" leadsHref="/crm/leads" />,
    );
    const conversion = card(container, "crm.leads.dashboard.conversionRate");
    const sibling = card(container, "crm.leads.dashboard.converted");
    expect(conversion?.tagName).toBe("A");
    expect(conversion?.getAttribute("href")).toBe("/crm/leads");
    expect(conversion?.hasAttribute("data-interactive")).toBe(true);
    expect(conversion?.hasAttribute("data-interactive")).toBe(
      sibling?.hasAttribute("data-interactive"),
    );
    expect(conversion?.className).toMatch(/focus-visible:outline-solid/);
  });

  it("is a static summary — like its siblings — without leads access (never a fake button)", () => {
    const { container } = render(<SalesOverviewPanel data={data} period="month" />);
    const conversion = card(container, "crm.leads.dashboard.conversionRate");
    expect(conversion?.tagName).toBe("DIV");
    expect(conversion?.hasAttribute("data-interactive")).toBe(false);
  });
});

function ranking(
  scope: SalesPerformanceDashboard["scope"],
  ranking: SalesPerformanceDashboard["ranking"],
): SalesPerformanceDashboard {
  return { ...data, period: "month", scope, ranking };
}

describe("RankingPanel — the report scope decides what the ranking shows (R15 D15-18)", () => {
  afterEach(cleanup);

  it("OWN: 'your rank X of N' over the company instead of hiding the panel; no leaderboard rows", () => {
    const { container } = render(
      <RankingPanel
        data={ranking("OWN", { self: { rank: 3, orders: 7, of: 12 }, leaderboard: [] })}
        period="month"
      />,
    );
    expect(container.textContent).toContain('salesVisibility.rankOf{"position":3,"of":12}');
    expect(container.textContent).toContain("salesVisibility.amongCompany");
    expect(container.textContent).toContain("salesVisibility.ownOnly");
    expect(container.querySelector("ol")).toBeNull();
    expect(container.textContent).not.toContain("dashboard.overview.rankingEmpty");
  });

  it("OWN without an order in the period: 'not ranked yet' and the ranked count, never an invented rank", () => {
    const { container } = render(
      <RankingPanel
        data={ranking("OWN", { self: { rank: null, orders: 0, of: 12 }, leaderboard: [] })}
        period="today"
      />,
    );
    expect(container.textContent).toContain("salesVisibility.notRanked");
    expect(container.textContent).toContain('salesVisibility.notRankedHint{"of":12}');
    expect(container.textContent).not.toContain("salesVisibility.rankOf");
  });

  it("TEAM: the team ranked within itself, the manager's company position, own row found by id", () => {
    const { container } = render(
      <RankingPanel
        data={ranking("TEAM", {
          self: { rank: 5, orders: 2, of: 12 },
          leaderboard: [
            { rank: 1, userId: "u-a", displayName: "Member A", orders: 9 },
            { rank: 2, userId: "u-self", displayName: "Manager", orders: 2 },
          ],
        })}
        period="week"
      />,
    );
    expect(container.textContent).toContain("salesVisibility.companyRank");
    expect(container.textContent).toContain('docUi.dashboard.rank{"rank":5,"of":12}');
    const current = container.querySelector('[aria-current="true"]');
    expect(current?.textContent).toContain("Manager");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });
});
