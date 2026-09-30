import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReportExportDocument } from "@/lib/report-export";

/*
 * spec-4 §4A — collapsing the report header is a screen preference only:
 * Excel/CSV and print are rebuilt from the report's data, so the exported
 * document (title, period, currency, filters, summary, rows) must be
 * byte-for-byte the same whether the header is collapsed or expanded.
 */

const exported: ReportExportDocument[] = [];
const printed: unknown[] = [];

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    locale: "en",
    direction: "ltr",
  }),
}));
vi.mock("@/providers/company-provider", () => ({
  useCompany: () => ({
    activeCompany: { id: "c1", name: "Co", logoUrl: null },
    companies: [{ id: "c1", name: "Co", branches: [] }],
  }),
}));
vi.mock("@/components/print/print-brand", () => ({ usePrintCompany: () => ({ name: "Co" }) }));
vi.mock("@/providers/user-context", () => ({
  useUserContext: () => ({ user: { fullName: "Tester" } }),
}));
vi.mock("@/hooks/use-print-engine", () => ({
  usePrintEngine: () => ({
    runPrint: async (_kind: string, load: () => Promise<unknown>) => {
      printed.push(await load());
    },
  }),
}));
vi.mock("@/lib/report-export", () => ({
  downloadReport: async (document: ReportExportDocument) => {
    exported.push(document);
  },
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  reportApiError: vi.fn(),
}));
vi.mock("./use-report-format", () => ({
  useReportCurrency: () => "EGP",
  useDrCrLabels: () => ({ debit: "Dr", credit: "Cr" }),
}));
vi.mock("./financial-report-table", () => ({ FinancialReportTable: () => null }));
vi.mock("@/components/accounting/report-filter-bar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/accounting/report-filter-bar")>();
  return {
    ...actual,
    useReportFilterOptions: () => ({ costCenters: [], projects: [], currencies: [] }),
    ReportFilterRow: () => <div data-testid="filter-row" />,
  };
});
vi.mock("./financial-report-header", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./financial-report-header")>();
  return {
    ...actual,
    FinancialReportActions: ({
      onExport,
      onPrint,
    }: {
      onExport: (format: "csv") => void;
      onPrint: () => void;
    }) => (
      <>
        <button type="button" onClick={() => onExport("csv")}>
          export-csv
        </button>
        <button type="button" onClick={onPrint}>
          print
        </button>
      </>
    ),
  };
});

import { TooltipProvider } from "@/components/ui/tooltip";
import { EMPTY_REPORT_FILTERS } from "@/components/accounting/report-filter-bar";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import { FinancialReport } from "./financial-report";
import type { FinancialReportLine } from "./types";

const LINES: FinancialReportLine[] = [
  {
    id: "rev",
    parentId: null,
    kind: "section",
    level: 0,
    label: "Revenue",
    expandable: true,
    values: { balance: 1500 },
    children: [
      {
        id: "rev-sales",
        parentId: "rev",
        kind: "posting",
        level: 1,
        code: "4000",
        label: "Sales",
        expandable: false,
        values: { balance: 1500 },
        children: [],
      },
    ],
  },
];

const FILTERS = {
  ...EMPTY_REPORT_FILTERS,
  companyId: "c1",
  postedOnly: false,
  dateRange: { from: new Date(2026, 0, 1), to: new Date(2026, 8, 30) },
};

function renderReport() {
  return render(
    <TooltipProvider>
      <FinancialReport
        title="Income statement"
        lines={LINES}
        columns={[{ key: "balance", labelKey: "reports.finance.fields.balance" }]}
        filters={FILTERS}
        onFiltersChange={() => {}}
        printTitle="Income statement"
        exportFileName="income-statement.csv"
        summary={{
          items: [{ id: "net", label: "Net profit", value: 1500, tone: "result" }],
          check: {
            label: "Debits = Credits",
            balanced: false,
            difference: 25,
          },
          notes: [{ id: "UNCLASSIFIED", label: "Warning", text: "2 unclassified accounts" }],
        }}
      />
    </TooltipProvider>,
  );
}

async function exportAndPrint() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "export-csv" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "print" }));
  });
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  exported.length = 0;
  printed.length = 0;
  localStorage.clear();
});
afterEach(cleanup);

describe("FinancialReport header collapse", () => {
  it("exports and prints the same document collapsed or expanded", async () => {
    renderReport();
    expect(screen.getByRole("button", { name: "reports.finance.header.collapse" })).toHaveProperty(
      "ariaExpanded",
      "true",
    );
    await exportAndPrint();
    cleanup();

    localStorage.setItem(STORAGE_KEYS.reportSummaryCollapsed, "true");
    renderReport();
    const toggle = await screen.findByRole("button", { name: "reports.finance.header.expand" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await exportAndPrint();

    expect(exported).toHaveLength(2);
    expect(printed).toHaveLength(2);
    const [expanded, collapsed] = exported;
    expect(collapsed).toEqual(expanded);
    expect(printed[1]).toEqual(printed[0]);
    // The full context still travels with the collapsed output.
    const meta = JSON.stringify(collapsed);
    expect(meta).toContain("Income statement");
    expect(meta).toContain("EGP");
    expect(meta).toContain("reports.finance.filters.company");
    expect(meta).toContain("2 unclassified accounts");
  });

  it("remembers the preference and keeps caveats visible on the strip", async () => {
    renderReport();
    fireEvent.click(screen.getByRole("button", { name: "reports.finance.header.collapse" }));
    expect(localStorage.getItem(STORAGE_KEYS.reportSummaryCollapsed)).toBe("true");
    // Unbalanced + drafts included + one report warning.
    expect(
      screen.getByRole("button", { name: 'reports.finance.header.warningsCount:{"count":3}' }),
    ).toBeTruthy();
    // The summary strip stays in the DOM (aria-controls target) but hidden.
    const toggle = screen.getByRole("button", { name: "reports.finance.header.expand" });
    const summaryId = toggle.getAttribute("aria-controls")?.split(" ").at(-1);
    expect(document.getElementById(summaryId!)?.hidden).toBe(true);
    // The filter badge opens the filter row without expanding the header.
    expect(screen.queryByTestId("filter-row")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /showFilters/ }));
    expect(screen.getByTestId("filter-row")).toBeTruthy();
  });
});
