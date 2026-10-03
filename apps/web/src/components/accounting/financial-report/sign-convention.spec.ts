// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatAmount } from "@/lib/money";
import { buildReportCsv } from "@/lib/report-export";
import { buildFinancialReportDocument, toReportPrintPayload } from "./financial-report-export";
import type { FinancialReportLine } from "./types";

/**
 * R6 (spec D2): balance columns dropped the repeated Dr/Cr suffix in favour
 * of a minus sign. This is a PRESENTATION change only — these tests pin that
 * every representative figure means exactly what it meant before: the same
 * absolute amount, debit-positive (Dr ⇔ positive, Cr ⇔ negative), and the
 * raw exported numbers are unchanged.
 */

/** The pre-R6 `drcr` text, reproduced verbatim for comparison. */
function legacyDrCr(value: number): string {
  if (Math.abs(value) < 0.005) return "—";
  const absolute = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  return `${absolute} ${value < 0 ? "Cr" : "Dr"}`;
}

/** Reads a legacy "1,234.50 Cr" back to its signed number. */
function parseLegacy(text: string): number {
  if (text === "—") return 0;
  const [figure, side] = text.split(" ");
  const amount = Number(figure.replace(/,/g, ""));
  return side === "Cr" ? -amount : amount;
}

/** Reads a new "-1,234.50" back to its signed number. */
function parseNew(text: string): number {
  return Number(text.replace(/,/g, ""));
}

const line = (id: string, values: Record<string, number>): FinancialReportLine => ({
  id,
  parentId: null,
  kind: "posting",
  level: 1,
  label: id,
  expandable: false,
  values,
  children: [],
});

// Representative Trial Balance / ledger rows: debit and credit balances,
// sub-cent residue, large figures, an account that nets to zero.
const ROWS: Array<{ id: string; opening: number; debit: number; credit: number; closing: number }> =
  [
    { id: "cash", opening: 12500, debit: 3000.5, credit: 1200.25, closing: 14300.25 },
    { id: "payables", opening: -8000, debit: 500, credit: 2750.75, closing: -10250.75 },
    { id: "revenue", opening: 0, debit: 0, credit: 98765432.1, closing: -98765432.1 },
    { id: "clearing", opening: 150, debit: 0, credit: 150, closing: 0 },
    { id: "rounding", opening: 0, debit: 0.01, credit: 0, closing: 0.01 },
    { id: "refund", opening: -0.01, debit: 0, credit: 0, closing: -0.01 },
  ];

const COLUMNS = ["opening", "debit", "credit", "closing"].map((key) => ({
  key,
  labelKey: `reports.finance.fields.${key}`,
}));

function document() {
  return buildFinancialReportDocument({
    title: "TB",
    lines: ROWS.map(({ id, ...values }) => line(id, values)),
    columns: COLUMNS,
    locale: "en",
    direction: "ltr",
    t: (key) => key,
    companyName: "OMS",
    printedByName: null,
  });
}

describe("R6 sign convention — Dr/Cr suffix → minus sign, same meaning", () => {
  it("every balance prints the same signed figure the legacy Dr/Cr text meant", () => {
    const payload = toReportPrintPayload(document(), { name: "OMS" }, null);
    ROWS.forEach((row, index) => {
      for (const key of ["opening", "closing"] as const) {
        const printed = String(payload.rows[index][key]);
        const legacy = legacyDrCr(row[key]);
        expect(parseNew(printed)).toBe(parseLegacy(legacy));
        expect(parseNew(printed)).toBe(Math.round(row[key] * 100) / 100);
        // Same digits; only the side marker moved (Cr ⇔ leading minus).
        if (legacy !== "—") {
          expect(printed.replace(/^-/, "")).toBe(legacy.split(" ")[0]);
          expect(printed.startsWith("-")).toBe(legacy.endsWith("Cr"));
        } else {
          expect(printed).toBe("0.00");
        }
      }
    });
  });

  it("debit/credit columns are untouched apart from 0.00 for a genuine zero", () => {
    const payload = toReportPrintPayload(document(), { name: "OMS" }, null);
    ROWS.forEach((row, index) => {
      expect(payload.rows[index].debit).toBe(formatAmount(row.debit));
      expect(payload.rows[index].credit).toBe(formatAmount(row.credit));
      expect(String(payload.rows[index].debit).startsWith("-")).toBe(false);
    });
  });

  it("CSV keeps the raw signed numbers (identical to the API values)", () => {
    const csv = buildReportCsv(document());
    for (const row of ROWS) {
      const cells = [row.opening, row.debit, row.credit, row.closing]
        .map((value) => `"${value.toFixed(2)}"`)
        .join(",");
      expect(csv).toContain(cells);
    }
  });
});
