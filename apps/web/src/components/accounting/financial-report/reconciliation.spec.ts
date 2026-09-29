// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatAmount } from "@/lib/money";
import { resolveReconciliationState, summaryToText } from "./summary-format";
import type { FinancialReportCheck } from "./types";

const t = (key: string) =>
  ({
    "reports.finance.balanced": "Balanced",
    "reports.finance.unbalanced": "Not balanced",
    "reports.finance.discrepancy": "Discrepancy",
    "reports.finance.checkNotApplicable": "Not applicable",
  })[key] ?? key;

const base: FinancialReportCheck = {
  balanced: true,
  difference: 0,
  label: "Debits = Credits",
};

describe("resolveReconciliationState", () => {
  it("is balanced when the API says so and the sides agree", () => {
    expect(resolveReconciliationState(base)).toBe("balanced");
    // Sub-cent float noise is not a discrepancy.
    expect(resolveReconciliationState({ ...base, difference: 0.004 })).toBe("balanced");
  });

  it("is unbalanced when the API says so, even with no visible difference", () => {
    expect(resolveReconciliationState({ ...base, balanced: false })).toBe("unbalanced");
  });

  it("is unbalanced when the figures differ, whatever the API verdict", () => {
    expect(resolveReconciliationState({ ...base, difference: 1250 })).toBe("unbalanced");
    expect(resolveReconciliationState({ ...base, difference: -0.01 })).toBe("unbalanced");
  });

  it("is not applicable when the check does not hold for the filters — whatever the figures", () => {
    expect(
      resolveReconciliationState({
        ...base,
        balanced: false,
        difference: 16450,
        notApplicable: "Specific accounts selected",
      }),
    ).toBe("not-applicable");
  });
});

describe("reconciliation export text", () => {
  const drcrLabels = { debit: "Dr", credit: "Cr" };

  it("writes report caveats (e.g. unclassified accounts) into print/export after the verdict", () => {
    const text = summaryToText(
      {
        items: [{ id: "net", label: "Net profit", value: 305 }],
        notes: [
          {
            id: "UNCLASSIFIED_ACCOUNTS",
            label: "Caveat",
            text: "1 account(s) have no statement line — shown under Unclassified. XE (-5.00)",
          },
        ],
      },
      { currency: "EGP", drcrLabels, t },
    );
    expect(text.at(-1)).toEqual({
      id: "summary:note:UNCLASSIFIED_ACCOUNTS",
      label: "Caveat",
      value: "1 account(s) have no statement line — shown under Unclassified. XE (-5.00)",
    });
    expect(text).toHaveLength(2);
  });

  it("exports the compared totals unchanged (same formatAmount) and the verdict", () => {
    const debit = 10258224.64;
    const credit = 10258224.64;
    const text = summaryToText(
      {
        items: [],
        check: {
          ...base,
          sides: [
            { id: "debit", label: "Debit total", value: debit },
            { id: "credit", label: "Credit total", value: credit },
          ],
        },
      },
      { currency: "EGP", drcrLabels, t },
    );
    expect(text).toEqual([
      {
        id: "summary:check:debit",
        label: "Debit total",
        value: formatAmount(debit, { zero: "dash", currency: "EGP" }),
      },
      {
        id: "summary:check:credit",
        label: "Credit total",
        value: formatAmount(credit, { zero: "dash", currency: "EGP" }),
      },
      { id: "summary:check", label: "Debits = Credits", value: "Balanced" },
    ]);
    expect(text[0].value).toBe("10,258,224.64 EGP");
  });

  it("states the exact discrepancy when unbalanced", () => {
    const text = summaryToText(
      {
        items: [],
        check: {
          ...base,
          difference: -1250,
          sides: [
            { id: "debit", label: "Debit total", value: 1248750 },
            { id: "credit", label: "Credit total", value: 1250000 },
          ],
        },
      },
      { currency: "EGP", drcrLabels, t },
    );
    expect(text.map((row) => row.value)).toEqual([
      "1,248,750.00 EGP",
      "1,250,000.00 EGP",
      "Not balanced — Discrepancy 1,250.00 EGP",
    ]);
  });

  it("never states a verdict when not applicable", () => {
    const text = summaryToText(
      { items: [], check: { ...base, notApplicable: "Specific accounts selected" } },
      { currency: "EGP", drcrLabels, t },
    );
    expect(text).toEqual([
      {
        id: "summary:check",
        label: "Debits = Credits",
        value: "Not applicable — Specific accounts selected",
      },
    ]);
  });
});
