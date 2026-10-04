import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({ t: (key: string) => key, locale: "en", direction: "ltr" }),
}));

import { FinancialReportCards } from "./financial-report-cards";
import type { FinancialReportColumn, FinancialReportLine } from "./types";

const line = (
  id: string,
  label: string,
  level: number,
  values: Record<string, number>,
  children: FinancialReportLine[] = [],
  kind: FinancialReportLine["kind"] = children.length ? "group" : "posting",
): FinancialReportLine => ({
  id,
  parentId: null,
  kind,
  level,
  label,
  expandable: children.length > 0,
  values,
  children,
});

const columns: FinancialReportColumn[] = [
  { key: "debit", labelKey: "reports.finance.fields.debit" },
  { key: "credit", labelKey: "reports.finance.fields.credit" },
  { key: "closing", labelKey: "reports.finance.fields.closing", emphasize: true },
];

const assets = line("a", "Assets", 0, { debit: 150, credit: 50, closing: 100 }, [
  line("a1", "Cash", 1, { debit: 100, credit: 20, closing: 80 }),
  line("a2", "Bank", 1, { debit: 50, credit: 30, closing: 20 }),
]);
const liabilities = line("l", "Liabilities", 0, { debit: 0, credit: 100, closing: -100 }, [
  line("l1", "Payables", 1, { debit: 0, credit: 100, closing: -100 }),
]);
const total = line("t", "Net", 0, { debit: 150, credit: 150, closing: 0 }, [], "grand_total");

const render_ = (expanded: string[], onToggle = vi.fn()) =>
  render(
    <FinancialReportCards
      lines={[assets, liabilities, total]}
      columns={columns}
      expanded={new Set(expanded)}
      onToggle={onToggle}
      emptyLabel="empty"
      footer={{ values: { debit: 150, credit: 150, closing: 0 } }}
    />,
  );

afterEach(cleanup);

describe("FinancialReportCards (grouped-card Grid of a financial report)", () => {
  it("draws one card per top-level section, plus one for childless lines and the totals", () => {
    const { container } = render_(["a", "l"]);
    const cards = container.querySelectorAll("[data-record-card]");
    // Assets, Liabilities, the closing card (Net) and the report totals.
    expect(cards).toHaveLength(4);
  });

  it("keeps the hierarchy: children sit inside their section's card, in order", () => {
    const { container } = render_(["a", "l"]);
    const first = container.querySelectorAll("[data-record-card]")[0];
    const rows = [...first.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(rows[0]).toContain("Assets");
    expect(rows[1]).toContain("Cash");
    expect(rows[2]).toContain("Bank");
    expect(first.textContent).not.toContain("Payables");
  });

  it("shows EVERY amount column, named, on every row (no column dropped)", () => {
    const { container } = render_(["a"]);
    const cash = [...container.querySelectorAll("li")].find((li) =>
      li.textContent?.includes("Cash"),
    )!;
    const labels = [...cash.querySelectorAll("dt")].map((dt) => dt.textContent);
    expect(labels).toEqual([
      "reports.finance.fields.debit",
      "reports.finance.fields.credit",
      "reports.finance.fields.closing",
    ]);
  });

  it("collapsed sections hide their rows but keep the section figures; toggling calls the table's handler", () => {
    const onToggle = vi.fn();
    const { container, getByLabelText } = render_([], onToggle);
    expect(container.textContent).not.toContain("Cash");
    expect(container.textContent).toContain("Assets");
    fireEvent.click(getByLabelText("Assets"));
    expect(onToggle).toHaveBeenCalledWith("a");
  });

  it("has no nested interactive controls inside a row other than the toggle and links", () => {
    const { container } = render_(["a"]);
    expect(container.querySelectorAll("li button button, li a a")).toHaveLength(0);
  });

  it("renders the empty label when there are no lines", () => {
    const { getByText } = render(
      <FinancialReportCards
        lines={[]}
        columns={columns}
        expanded={new Set()}
        onToggle={() => {}}
        emptyLabel="nothing here"
      />,
    );
    expect(getByText("nothing here")).toBeTruthy();
  });
});
