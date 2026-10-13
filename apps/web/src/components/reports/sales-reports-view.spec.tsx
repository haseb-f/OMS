import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  EmployeePeriodsReport,
  EmployeePeriodsRow,
  LiveReport,
  PerformanceReport,
  PeriodStats,
  SalesReportScope,
} from "@/services/sales-reports-service";
import { PERIOD_IDENTITY } from "@/components/reports/report-identity";
import { formatMoney } from "@/lib/money";
import { formatNumber } from "@/lib/format-number";

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
const employeePeriods =
  vi.fn<
    (source: string, params: { page: number; pageSize: number }) => Promise<EmployeePeriodsReport>
  >();
vi.mock("@/services/sales-reports-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/sales-reports-service")>()),
  salesReportsService: {
    live: (source: string) => live(source),
    performance: (source: string) => performance(source),
    employeePeriods: (source: string, params: { page: number; pageSize: number }) =>
      employeePeriods(source, params),
  },
}));

import { SalesReportsView } from "./sales-reports-view";

const NO_SALES = { orders: 0, valid: 0, cancelled: 0, returned: 0, amounts: [] };
const PERIODS = ["today", "yesterday", "last7Days", "thisMonth", "lastMonth"] as const;

function liveReport(scope: SalesReportScope): LiveReport {
  return { scope, timeZone: "Africa/Cairo", generatedAt: "2026-10-07T10:00:00Z", periods: [] };
}

function periods(overrides: Partial<Record<(typeof PERIODS)[number], Partial<PeriodStats>>> = {}) {
  return PERIODS.map((period) => ({ period, ...NO_SALES, ...overrides[period] }));
}

function row(overrides: Partial<EmployeePeriodsRow>): EmployeePeriodsRow {
  return {
    userId: "u-1",
    name: "Seller One",
    reference: "EMP-2026-000001",
    rank: 1,
    periods: periods(),
    ...overrides,
  };
}

function periodsReport(overrides: Partial<EmployeePeriodsReport>): EmployeePeriodsReport {
  return {
    scope: "OWN",
    timeZone: "Africa/Cairo",
    generatedAt: "2026-10-07T10:00:00Z",
    periods: [
      { period: "today", from: "2026-10-07", to: "2026-10-07" },
      { period: "yesterday", from: "2026-10-06", to: "2026-10-06" },
      { period: "last7Days", from: "2026-10-01", to: "2026-10-07" },
      { period: "thisMonth", from: "2026-10-01", to: "2026-10-07" },
      { period: "lastMonth", from: "2026-09-01", to: "2026-09-30" },
    ],
    rankPeriod: "thisMonth",
    employees: [],
    page: 1,
    pageSize: 10,
    total: 0,
    ownRank: { position: null, of: 0 },
    unassigned: null,
    agents: null,
    ...overrides,
  };
}

async function tabsFor(scope: SalesReportScope, source: "company" | "agent" = "company") {
  live.mockResolvedValue(liveReport(scope));
  render(<SalesReportsView source={source} />);
  await waitFor(() => expect(screen.getAllByRole("tab").length).toBeGreaterThan(1));
  return screen.getAllByRole("tab").map((tab) => tab.textContent);
}

const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

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
    employeePeriods.mockResolvedValue(
      periodsReport({
        scope: "TEAM",
        ownRank: { position: 3, of: 12 },
        total: 1,
        employees: [row({ name: "Member One" })],
      }),
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "salesReports.tabs.employees" }));
    expect(
      await screen.findByText('salesVisibility.companyRankLine{"position":3,"of":12}'),
    ).toBeTruthy();
    expect(screen.getByText("Member One")).toBeTruthy();
    // One request for the page — never one per employee or per period.
    expect(employeePeriods).toHaveBeenCalledTimes(1);
    expect(employeePeriods).toHaveBeenCalledWith("company", { page: 1, pageSize: 10 });
    expect(performance).not.toHaveBeenCalled();
  });

  it("My performance shows the own card and 'rank X of N' this month — nothing else", async () => {
    await tabsFor("OWN");
    employeePeriods.mockResolvedValue(
      periodsReport({
        ownRank: { position: 3, of: 12 },
        total: 1,
        employees: [row({ userId: "me", name: "Me", reference: "me.sales", rank: 3 })],
      }),
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "salesReports.tabs.own" }));
    expect(
      await screen.findByText('salesReports.employeePeriods.ownRank{"position":3,"of":12}'),
    ).toBeTruthy();
    expect(screen.getByText("salesVisibility.ownOnly")).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("me.sales")).toBeTruthy();
  });

  it("an unranked agent seller reads 'not ranked this month'", async () => {
    await tabsFor("AGENT_OWN", "agent");
    employeePeriods.mockResolvedValue(
      periodsReport({
        scope: "AGENT_OWN",
        ownRank: { position: null, of: 4 },
        total: 1,
        employees: [row({ rank: null })],
      }),
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "salesReports.tabs.own" }));
    expect(await screen.findByText("salesReports.employeePeriods.notRanked")).toBeTruthy();
    expect(employeePeriods).toHaveBeenCalledWith("agent", { page: 1, pageSize: 10 });
  });

  it("ALL: orders without an owner and agents are separate period cards, apart from the employees", async () => {
    await tabsFor("ALL");
    employeePeriods.mockResolvedValue(
      periodsReport({
        scope: "ALL",
        total: 1,
        unassigned: periods({ today: { orders: 2, valid: 2 } }),
        agents: periods(),
        employees: [row({})],
      }),
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "salesReports.tabs.employees" }));
    expect(await screen.findByText("salesReports.employees.unassigned")).toBeTruthy();
    expect(screen.getByText("salesReports.employees.unassignedHint")).toBeTruthy();
    expect(screen.getByText("salesReports.employees.agentsTitle")).toBeTruthy();
    expect(screen.queryByText(/salesVisibility\.companyRankLine/)).toBeNull();
    // The feed holds the employees only; the separate rows are outside it.
    expect(within(screen.getByRole("feed")).getAllByRole("article")).toHaveLength(1);
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("each employee card shows the five period boxes with the exact figures, per currency", async () => {
    await tabsFor("ALL");
    const seller = row({
      periods: periods({
        today: {
          orders: 4,
          valid: 3,
          cancelled: 1,
          amounts: [
            { currencyCode: "EGP", amount: 1250.5 },
            { currencyCode: "SAR", amount: 300 },
          ],
        },
        lastMonth: {
          orders: 1,
          valid: 1,
          returned: 1,
          amounts: [{ currencyCode: "EGP", amount: 40 }],
        },
      }),
    });
    employeePeriods.mockResolvedValue(
      periodsReport({ scope: "ALL", total: 1, employees: [seller] }),
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "salesReports.tabs.employees" }));
    const card = await screen.findByRole("article", { name: "Seller One" });
    expect(card.getAttribute("tabindex")).toBe("0");
    expect(card.getAttribute("aria-posinset")).toBe("1");
    expect(card.getAttribute("aria-setsize")).toBe("1");
    expect(within(card).getByText('salesReports.employeePeriods.rank{"rank":1}')).toBeTruthy();
    const boxes = [...card.querySelectorAll('[data-slot="insight-card"]')];
    expect(boxes).toHaveLength(5);
    expect(boxes.map((box) => box.getAttribute("data-identity"))).toEqual(
      PERIODS.map((period) => PERIOD_IDENTITY[period].hue),
    );
    expect(boxes.map((box) => text(box.querySelector('[data-slot="insight-label"]')))).toEqual(
      PERIODS.map((period) => `salesReports.periods.${period}`),
    );
    const today = boxes[0];
    expect(text(today.querySelector('[data-slot="insight-value"]'))).toBe(formatNumber(3));
    expect(
      [...today.querySelectorAll('[data-slot="report-amounts"] li')].map((li) => text(li)),
    ).toEqual([formatMoney(1250.5, "EGP"), formatMoney(300, "SAR")]);
    expect(text(boxes[1].querySelector('[data-slot="report-amounts"]'))).toBe(
      "salesReports.stats.noSales",
    );
    expect(text(boxes[4])).toContain(formatMoney(40, "EGP"));
    // The boundaries are stated once, above the cards.
    expect(screen.getByText(/salesReports\.employeePeriods\.last7Includes/)).toBeTruthy();
  });

  it("pages by employee: the pager asks the API for the next page", async () => {
    await tabsFor("ALL");
    employeePeriods.mockImplementation(async (_source, params) =>
      periodsReport({
        scope: "ALL",
        page: params.page,
        pageSize: 10,
        total: 12,
        employees: [row({ userId: `u-${params.page}`, name: `Seller ${params.page}` })],
      }),
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "salesReports.tabs.employees" }));
    expect(await screen.findByText("Seller 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "table.goToNextPage" }));
    expect(await screen.findByText("Seller 2")).toBeTruthy();
    expect(employeePeriods).toHaveBeenLastCalledWith("company", { page: 2, pageSize: 10 });
    expect(screen.getByRole("article", { name: "Seller 2" }).getAttribute("aria-posinset")).toBe(
      "11",
    );
  });
});
