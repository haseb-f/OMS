import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  LiveReport,
  PerformanceReport,
  SalesReportScope,
} from "@/services/sales-reports-service";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params ? `${key}${JSON.stringify(params)}` : key,
    locale: "en",
    direction: "ltr",
  }),
}));

const live = vi.fn<(source: string) => Promise<LiveReport>>();
const performance = vi.fn<(source: string) => Promise<PerformanceReport>>();
vi.mock("@/services/sales-reports-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/sales-reports-service")>()),
  salesReportsService: {
    live: (source: string) => live(source),
    performance: (source: string) => performance(source),
  },
}));

import { SalesReportsView } from "./sales-reports-view";

const NO_SALES = { orders: 0, valid: 0, cancelled: 0, returned: 0, amounts: [] };

function liveReport(scope: SalesReportScope): LiveReport {
  return { scope, timeZone: "Africa/Cairo", generatedAt: "2026-10-07T10:00:00Z", periods: [] };
}

function performanceReport(overrides: Partial<PerformanceReport>): PerformanceReport {
  return {
    scope: "OWN",
    timeZone: "Africa/Cairo",
    generatedAt: "2026-10-07T10:00:00Z",
    from: "2026-10-01",
    to: "2026-10-07",
    rankBy: "count",
    currency: null,
    currencies: [],
    employees: [],
    employeesTruncated: false,
    ownRank: { position: null, of: 0 },
    teams: null,
    agents: null,
    unassigned: null,
    paymentMix: [],
    ...overrides,
  };
}

async function tabsFor(scope: SalesReportScope, source: "company" | "agent" = "company") {
  live.mockResolvedValue(liveReport(scope));
  render(<SalesReportsView source={source} />);
  await waitFor(() => expect(screen.getAllByRole("tab").length).toBeGreaterThan(1));
  return screen.getAllByRole("tab").map((tab) => tab.textContent);
}

describe("SalesReportsView — tabs and figures follow the report scope (R15 D15-18)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("an own scope never offers Employees / Teams / Comparison", async () => {
    expect(await tabsFor("OWN")).toEqual([
      "salesReports.tabs.live",
      "salesReports.tabs.own",
      "salesReports.tabs.paymentMix",
    ]);
  });

  it("the agent team view (AGENT_ALL) has no company Teams tab; an agent seller only their own", async () => {
    expect(await tabsFor("AGENT_ALL", "agent")).toEqual([
      "salesReports.tabs.live",
      "salesReports.tabs.employees",
      "salesReports.tabs.comparison",
      "salesReports.tabs.paymentMix",
    ]);
    cleanup();
    expect(await tabsFor("AGENT_OWN", "agent")).not.toContain("salesReports.tabs.employees");
  });

  it("a team manager gets the team tabs and their company position", async () => {
    expect(await tabsFor("TEAM")).toContain("salesReports.tabs.teams");
    performance.mockResolvedValue(
      performanceReport({
        scope: "TEAM",
        ownRank: { position: 3, of: 12 },
        teams: [],
        employees: [
          { ...NO_SALES, valid: 5, rank: 1, rankValue: 5, userId: "u-1", name: "Member One" },
        ],
      }),
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "salesReports.tabs.employees" }));
    expect(
      await screen.findByText('salesVisibility.companyRankLine{"position":3,"of":12}'),
    ).toBeTruthy();
    expect(screen.getByText("Member One")).toBeTruthy();
  });

  it("My performance shows the own figures and 'rank X of N' — nothing else", async () => {
    await tabsFor("OWN");
    performance.mockResolvedValue(
      performanceReport({
        ownRank: { position: 3, of: 12 },
        employees: [
          {
            ...NO_SALES,
            orders: 4,
            valid: 3,
            cancelled: 1,
            rank: 3,
            rankValue: 3,
            userId: "me",
            name: "Me",
          },
        ],
      }),
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "salesReports.tabs.own" }));
    expect(await screen.findByText('salesVisibility.rankOf{"position":3,"of":12}')).toBeTruthy();
    expect(screen.getByText("salesVisibility.amongCompany")).toBeTruthy();
    expect(screen.getByText("salesVisibility.ownSales")).toBeTruthy();
  });

  it("an unranked agent seller reads 'not ranked yet' with the agent population count", async () => {
    await tabsFor("AGENT_OWN", "agent");
    performance.mockResolvedValue(
      performanceReport({ scope: "AGENT_OWN", ownRank: { position: null, of: 4 } }),
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "salesReports.tabs.own" }));
    expect(await screen.findByText("salesVisibility.notRanked")).toBeTruthy();
    expect(screen.getByText('salesVisibility.notRankedHint{"of":4}')).toBeTruthy();
  });

  it("ALL: orders without an owner are a separate unranked row, apart from the employees", async () => {
    await tabsFor("ALL");
    performance.mockResolvedValue(
      performanceReport({
        scope: "ALL",
        teams: [],
        unassigned: { ...NO_SALES, orders: 2, valid: 2 },
        employees: [
          { ...NO_SALES, valid: 5, rank: 1, rankValue: 5, userId: "u-1", name: "Seller One" },
        ],
      }),
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "salesReports.tabs.employees" }));
    expect(await screen.findByText("salesReports.employees.unassigned")).toBeTruthy();
    expect(screen.getByText("salesReports.employees.unassignedHint")).toBeTruthy();
    expect(screen.queryByText(/salesVisibility\.companyRankLine/)).toBeNull();
  });
});
