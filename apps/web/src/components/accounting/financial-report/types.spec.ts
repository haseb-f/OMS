// @vitest-environment node
import { describe, expect, it } from "vitest";
import { displayAmount, resolveRowKinds, type FinancialReportLine } from "./types";
import { resolveSummaryTone, summaryToText } from "./summary-format";

const line = (overrides: Partial<FinancialReportLine>): FinancialReportLine => ({
  id: "x",
  parentId: null,
  kind: "posting",
  level: 1,
  label: "",
  expandable: false,
  values: {},
  children: [],
  ...overrides,
});

describe("resolveRowKinds", () => {
  it("maps a Balance Sheet: sections, parents, details, subtotals, one grand total", () => {
    const lines = [
      line({
        id: "equity",
        kind: "section",
        level: 0,
        children: [
          line({
            id: "g1",
            kind: "group",
            parentId: "equity",
            children: [line({ id: "a1", parentId: "g1", level: 2 })],
          }),
          // Current Earnings: a `result` inside a section — an ordinary row.
          line({ id: "current-earnings", kind: "result", parentId: null, level: 1 }),
          line({ id: "equity:total", kind: "section_total", parentId: "equity" }),
        ],
      }),
      line({ id: "liabilities-equity", kind: "grand_total", level: 0 }),
    ];
    const kinds = resolveRowKinds(lines);
    expect(kinds.get("equity")).toBe("section");
    expect(kinds.get("g1")).toBe("parent");
    expect(kinds.get("a1")).toBe("detail");
    expect(kinds.get("current-earnings")).toBe("detail");
    expect(kinds.get("equity:total")).toBe("subtotal");
    expect(kinds.get("liabilities-equity")).toBe("grand-total");
  });

  it("keeps exactly one grand total — the last top-level final line (cash flow)", () => {
    const lines = [
      line({ id: "cf-opening", kind: "opening", level: 0 }),
      line({ id: "cf-net", kind: "result", level: 0 }),
      line({ id: "cf-closing", kind: "closing", level: 0 }),
    ];
    const kinds = resolveRowKinds(lines);
    expect(kinds.get("cf-opening")).toBe("parent");
    expect(kinds.get("cf-net")).toBe("subtotal");
    expect(kinds.get("cf-closing")).toBe("grand-total");
    expect([...kinds.values()].filter((kind) => kind === "grand-total")).toHaveLength(1);
  });

  it("stresses ledger closing rows and leaves the grand total to the footer", () => {
    const lines = [
      line({
        id: "account:1",
        kind: "group",
        level: 0,
        children: [
          line({ id: "account:1:opening", kind: "opening", parentId: "account:1" }),
          line({ id: "account:1:m1", parentId: "account:1" }),
          line({ id: "account:1:closing", kind: "closing", parentId: "account:1" }),
        ],
      }),
    ];
    const kinds = resolveRowKinds(lines, { hasFooter: true });
    expect(kinds.get("account:1:closing")).toBe("subtotal");
    expect(kinds.get("account:1:m1")).toBe("detail");
    expect([...kinds.values()]).not.toContain("grand-total");
  });
});

describe("displayAmount", () => {
  it("shows a net loss as an absolute, adverse figure (the label carries the sign)", () => {
    expect(displayAmount({ id: "net-income", values: { balance: -500 } }, "balance")).toEqual({
      value: 500,
      adverse: true,
    });
    expect(displayAmount({ id: "net-income", values: { balance: 500 } }, "balance")).toEqual({
      value: 500,
      adverse: false,
    });
  });

  it("keeps every other value as-is and a missing value blank", () => {
    expect(displayAmount({ id: "a", values: { balance: -500 } }, "balance").value).toBe(-500);
    expect(displayAmount({ id: "a", values: {} }, "balance").value).toBeUndefined();
  });
});

describe("summary", () => {
  it("resolves the result tone by sign", () => {
    expect(resolveSummaryTone("result", 10)).toBe("profit");
    expect(resolveSummaryTone("result", -10)).toBe("loss");
    expect(resolveSummaryTone("result", 0.001)).toBe("neutral");
    expect(resolveSummaryTone(undefined, 10)).toBe("neutral");
    expect(resolveSummaryTone("revenue", -1)).toBe("revenue");
  });

  it("exports tiles and the balance check as the same text the screen shows", () => {
    const t = (key: string) =>
      ({
        "reports.finance.balanced": "Balanced",
        "reports.finance.unbalanced": "Not balanced",
        "reports.finance.discrepancy": "Discrepancy",
        "reports.finance.checkNotApplicable": "Not applicable",
      })[key] ?? key;
    const text = summaryToText(
      {
        items: [
          { id: "debit", label: "Debit", value: 1500 },
          { id: "closing", label: "Closing", value: -200 },
          { id: "zero", label: "Zero", value: 0 },
        ],
        check: { balanced: false, difference: -12.5, label: "Debits = Credits" },
      },
      { currency: "EGP", t },
    );
    expect(text).toEqual([
      { id: "summary:debit", label: "Debit", value: "1,500.00 EGP" },
      { id: "summary:closing", label: "Closing", value: "-200.00 EGP" },
      { id: "summary:zero", label: "Zero", value: "0.00 EGP" },
      {
        id: "summary:check",
        label: "Debits = Credits",
        value: "Not balanced — Discrepancy 12.50 EGP",
      },
    ]);
  });
});
