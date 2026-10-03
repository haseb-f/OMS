import { describe, expect, it } from "vitest";
import {
  buildFinancialReportDocument,
  toReportPrintPayload,
} from "@/components/accounting/financial-report/financial-report-export";
import { summaryToText } from "@/components/accounting/financial-report/summary-format";
import {
  displayAmount,
  flattenVisibleLines,
  collectExpandableIds,
  type FinancialReportColumn,
  type FinancialReportLine,
} from "@/components/accounting/financial-report/types";
import { buildReportCsv } from "@/lib/report-export";
import type { AccountLedgerMovement } from "@/services/accounting-reports-service";
import { LEDGER_COLUMNS, buildLedgerBlock, ledgerSummaryItems } from "./ledger-lines";

/**
 * R6 accounting review: balances keep the Debit − Credit sign (minus, no Dr/Cr
 * text); red means ADVERSE — a balance against its nature — never "credit".
 */
const t = (key: string) => key;

const movement = (patch: Partial<AccountLedgerMovement>): AccountLedgerMovement => ({
  lineId: "l",
  journalEntryId: "je",
  entryNumber: "JV-1",
  entryDate: "2026-10-01T00:00:00.000Z",
  description: "Supplier invoice",
  sourceType: null,
  sourceId: null,
  referenceNumber: null,
  status: "POSTED",
  journal: null,
  partner: null,
  accountId: "a",
  accountCode: "2100",
  accountName: "Payables",
  accountNameEn: null,
  partnerControlType: "PAYABLE",
  debit: 0,
  credit: 0,
  runningBalance: 0,
  ...patch,
});

// Supplier statement: credit opening (we owe 500 — normal), a purchase
// credit, then an overpayment that leaves the supplier owing us 200 (abnormal).
const SUPPLIER = {
  id: "partner:s1",
  code: "SUP-1",
  label: "Supplier",
  openingBalance: -500,
  periodDebit: 1000,
  periodCredit: 300,
  closingBalance: 200,
  normalSide: "credit" as const,
  movements: [
    movement({ lineId: "m1", credit: 300, runningBalance: -800 }),
    movement({ lineId: "m2", debit: 1000, runningBalance: 200, description: "Payment" }),
  ],
};

const balanceColumn = LEDGER_COLUMNS.find((column) => column.key === "balance")!;

function supplierLines(): FinancialReportLine[] {
  const block = buildLedgerBlock(SUPPLIER, t as never);
  return flattenVisibleLines([block], new Set(collectExpandableIds([block])));
}

describe("ledger sign + adverse decision (supplier statement, credit opening)", () => {
  it("prints the Debit − Credit sign with a minus and no Dr/Cr text", () => {
    const document = buildFinancialReportDocument({
      title: "Supplier statement",
      lines: supplierLines(),
      columns: LEDGER_COLUMNS,
      locale: "en",
      direction: "ltr",
      t: t as never,
      companyName: "OMS",
      printedByName: null,
    });
    const payload = toReportPrintPayload(document, { name: "OMS" }, null);
    // group, opening, m1, m2, closing
    expect(payload.rows.map((row) => [row.debit, row.credit, row.balance])).toEqual([
      ["1,000.00", "300.00", "200.00"],
      ["", "", "-500.00"],
      ["", "300.00", "-800.00"],
      ["1,000.00", "", "200.00"],
      ["1,000.00", "300.00", "200.00"],
    ]);
    expect(JSON.stringify(payload.rows)).not.toMatch(/\b(Dr|Cr)\b/);
    // CSV keeps the raw signed number.
    const csv = buildReportCsv(document);
    expect(csv).toContain('"-500.00"');
    expect(csv).toContain('"-800.00"');
  });

  it("is red only where the supplier balance is against its credit nature", () => {
    const decisions = supplierLines().map(
      (line) => displayAmount(line, "balance", balanceColumn).adverse,
    );
    // group (200 → supplier owes us), opening -500, -800, 200, closing 200
    expect(decisions).toEqual([true, false, false, true, true]);
  });

  it("summary text keeps the sign; only the abnormal closing tile is adverse", () => {
    const items = ledgerSummaryItems(t as never, SUPPLIER, "credit");
    expect(items.map((item) => [item.id, item.adverse ?? false])).toEqual([
      ["openingBalance", false],
      ["periodDebit", false],
      ["periodCredit", false],
      ["closingBalance", true],
    ]);
    const text = summaryToText({ items }, { currency: "EGP", t: t as never });
    expect(text.map((row) => row.value)).toEqual([
      "-500.00 EGP",
      "1,000.00 EGP",
      "300.00 EGP",
      "200.00 EGP",
    ]);
  });

  it("a customer statement (debit nature) is red only when negative", () => {
    const customer = buildLedgerBlock({ ...SUPPLIER, normalSide: "debit" }, t as never);
    const lines = flattenVisibleLines([customer], new Set(collectExpandableIds([customer])));
    expect(lines.map((line) => displayAmount(line, "balance", balanceColumn).adverse)).toEqual([
      false,
      true,
      true,
      false,
      false,
    ]);
  });
});

describe("Trial Balance rows by account nature", () => {
  const closing: FinancialReportColumn = { key: "closing", labelKey: "x", balance: true };
  const row = (accountType: string | undefined, value: number): FinancialReportLine => ({
    id: `r-${accountType}-${value}`,
    parentId: null,
    kind: "posting",
    level: 1,
    label: "row",
    accountType,
    expandable: false,
    values: { closing: value },
    children: [],
  });

  it("a liability credit balance is neutral; a negative asset is red; unknown nature never red", () => {
    expect(displayAmount(row("LIABILITY", -1000), "closing", closing).adverse).toBe(false);
    expect(displayAmount(row("ASSET", -50), "closing", closing).adverse).toBe(true);
    expect(displayAmount(row("ASSET", 50), "closing", closing).adverse).toBe(false);
    expect(displayAmount(row("REVENUE", 10), "closing", closing).adverse).toBe(true);
    expect(displayAmount(row(undefined, -50), "closing", closing).adverse).toBe(false);
    // A plain (non-balance) column is never red for a sign.
    expect(displayAmount(row("ASSET", -50), "closing").adverse).toBe(false);
  });
});
