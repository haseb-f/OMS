// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";
import type { Locale } from "@/i18n/locales";
import {
  buildFinancialReportDocument,
  toReportPrintPayload,
} from "@/components/accounting/financial-report/financial-report-export";
import type { FinancialReportLine } from "@/components/accounting/financial-report/types";
import { buildReportCsv, buildReportXlsx, excelNumberFormat } from "./report-export";
import { formatPeriod } from "./date";

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

const LINES: FinancialReportLine[] = [
  line({ id: "revenue", kind: "section", level: 0, label: "الإيرادات", labelEn: "Revenue" }),
  line({ id: "a1", code: "4100", label: "مبيعات", labelEn: "Sales", values: { balance: 1500.5 } }),
  line({ id: "expense", kind: "section", level: 0, label: "المصروفات", labelEn: "Expenses" }),
  line({
    id: "a2",
    code: "5100",
    label: "رواتب",
    labelEn: "Salaries",
    values: { balance: -300.25 },
  }),
];

function documentFor(locale: Locale) {
  return buildFinancialReportDocument({
    title: translate(messages[locale], "reports.finance.incomeStatement"),
    lines: LINES,
    columns: [{ key: "balance", labelKey: "reports.finance.fields.balance" }],
    footer: { values: { balance: 1200.25 } },
    locale,
    direction: locale === "ar" ? "rtl" : "ltr",
    t: (key: MessageKey) => translate(messages[locale], key),
    companyName: "OMS",
    printedByName: "QA",
    period: formatPeriod(new Date(2026, 0, 1), new Date(2026, 8, 30), { from: "From", to: "To" }),
    printedAt: new Date(2026, 8, 21, 10, 0),
  });
}

describe("report export follows the active language", () => {
  it("translates title, headers and line labels while keeping codes and numbers identical", () => {
    const ar = documentFor("ar");
    const en = documentFor("en");
    expect(ar.direction).toBe("rtl");
    expect(en.direction).toBe("ltr");
    expect(ar.title).not.toBe(en.title);
    expect(ar.columns.map((c) => c.label)).not.toEqual(en.columns.map((c) => c.label));
    expect(ar.rows.map((r) => r.cells.account)).toContain("مبيعات");
    expect(en.rows.map((r) => r.cells.account)).toContain("Sales");
    expect(ar.rows.map((r) => r.cells.code)).toEqual(en.rows.map((r) => r.cells.code));
    expect(ar.rows.map((r) => r.cells.balance)).toEqual(en.rows.map((r) => r.cells.balance));
    expect(ar.totals?.cells).toEqual(en.totals?.cells);
  });

  it("writes a BOM-prefixed CSV with translated headers and plain numbers", () => {
    const csv = buildReportCsv(documentFor("ar"));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(translate(messages.ar, "reports.finance.fields.accountCode"));
    expect(csv).toContain('"1500.50"');
    expect(csv).toContain('"1200.25"');
    // Bidi isolates that order dates on screen/print never reach the file.
    expect(csv).not.toMatch(/[‎‏⁦-⁩]/);
    expect(csv).toContain("01 Jan 2026");
  });

  it("writes an RTL .xlsx for Arabic and an LTR one for English with the same totals", async () => {
    const read = async (locale: Locale) => {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await buildReportXlsx(documentFor(locale)));
      return workbook.worksheets[0];
    };
    const ar = await read("ar");
    const en = await read("en");
    expect(ar.views[0]?.rightToLeft).toBe(true);
    expect(en.views[0]?.rightToLeft).toBe(false);
    expect(ar.getCell("A1").value).toBe(translate(messages.ar, "reports.finance.incomeStatement"));
    const lastValue = (sheet: ExcelJS.Worksheet) => sheet.getRow(sheet.rowCount).getCell(3).value;
    expect(lastValue(ar)).toBe(1200.25);
    expect(lastValue(en)).toBe(1200.25);
  });
});

describe("report export carries scope, summary and hierarchy", () => {
  const t = (key: MessageKey) => translate(messages.ar, key);
  const tb = () =>
    buildFinancialReportDocument({
      title: "TB",
      lines: [
        line({
          id: "g",
          kind: "group",
          level: 0,
          code: "1",
          label: "الأصول",
          values: { closing: 0 },
        }),
        line({ id: "a", code: "1100", label: "نقدية", values: { closing: 1500 } }),
        line({ id: "b", code: "2100", label: "موردون", values: { closing: -1500 } }),
      ],
      columns: [{ key: "closing", labelKey: "reports.finance.fields.closingBalance" }],
      footer: { values: { closing: 0 } },
      locale: "ar",
      direction: "rtl",
      t,
      companyName: "OMS",
      printedByName: null,
      currency: "EGP",
      filters: [{ id: "filter:branch", label: "الفرع", value: "القاهرة" }],
      summary: [{ id: "summary:check", label: "المدين = الدائن", value: "متوازن" }],
      printedAt: new Date(2026, 8, 21, 10, 0),
    });

  it("writes currency, language, filters and the summary into the meta", () => {
    const meta = tb().meta ?? [];
    const ids = meta.map((item) => item.id);
    expect(ids).toEqual(
      expect.arrayContaining(["currency", "language", "filter:branch", "summary:check"]),
    );
    expect(meta.find((item) => item.id === "language")?.value).toBe("العربية");
  });

  it("prints a minus for a credit balance (no Dr/Cr suffix), 0.00 for zero, indentation and row kinds", () => {
    const payload = toReportPrintPayload(tb(), { name: "OMS" }, null);
    expect(payload.rows.map((row) => row.closing)).toEqual([
      "0.00",
      "1,500.00",
      "-1,500.00",
      "0.00",
    ]);
    expect(String(payload.rows[1]?.account).startsWith(" ")).toBe(true);
    expect(payload.rows[3]?.account).toBe(translate(messages.ar, "reports.finance.totals"));
    expect(payload.rowKinds).toEqual(["parent", "detail", "detail", "grand-total"]);
    expect(payload.orientation).toBe("landscape");
    const meta = payload.meta ?? [];
    expect(meta).toContainEqual({ label: "الفرع", value: "القاهرة", ltr: false });
    expect(meta.map((item) => item.value)).toContain("EGP");
    // Company and printed at/by sit in the shared print header, not the strip.
    expect(meta.map((item) => item.label)).not.toContain(t("reportExport.printedAt"));
  });

  it("prints blank (never 0.00) where a cell does not apply, 0.00 for a genuine zero", () => {
    const document = buildFinancialReportDocument({
      title: "GL",
      lines: [
        line({ id: "o", kind: "opening", label: "Opening", values: { balance: -10 } }),
        line({ id: "p", label: "Narration", values: { debit: 0, credit: 5, balance: -15 } }),
      ],
      columns: [
        { key: "debit", labelKey: "reports.finance.fields.debit" },
        { key: "credit", labelKey: "reports.finance.fields.credit" },
        { key: "balance", labelKey: "reports.finance.fields.balance" },
      ],
      locale: "en",
      direction: "ltr",
      t,
      companyName: "OMS",
      printedByName: null,
    });
    const payload = toReportPrintPayload(document, { name: "OMS" }, null);
    expect(payload.rows.map((row) => [row.debit, row.credit, row.balance])).toEqual([
      ["", "", "-10.00"],
      ["0.00", "5.00", "-15.00"],
    ]);
    // Exports keep the raw numbers; a cell that does not apply stays empty.
    const csv = buildReportCsv(document);
    expect(csv).toContain('"0.00","5.00","-15.00"');
    expect(csv).toContain('"  Opening",,,"-10.00"');
  });

  it("states the period with explicit From/To words and Cairo printed-at time", () => {
    const meta = tb().meta ?? [];
    // 21 Sep 2026 10:00 local → printed in Cairo time (whatever the test zone).
    expect(meta.find((item) => item.id === "printedAt")?.value).toMatch(
      /^21 Sep 2026 — \d{2}:\d{2}$/,
    );
    const en = documentFor("en").meta ?? [];
    expect(en.find((item) => item.id === "period")?.value.replace(/[⁦⁩]/g, "")).toBe(
      "From 01 Jan 2026 · To 30 Sep 2026",
    );
  });

  it("gives a long label column (ledger narrations) a prose print column; short text stays on one line", () => {
    const document = buildFinancialReportDocument({
      title: "GL",
      lines: [
        line({
          id: "p",
          label: "Customer receipt for invoice INV-2026-000123 — bank transfer, partial settlement",
          text: { entry: "JE-2026-000001" },
          values: { debit: 100 },
        }),
      ],
      columns: [{ key: "debit", labelKey: "reports.finance.fields.debit" }],
      textColumns: [{ key: "entry", labelKey: "reports.finance.fields.entryNumber" }],
      locale: "en",
      direction: "ltr",
      t,
      companyName: "OMS",
      printedByName: null,
    });
    const payload = toReportPrintPayload(document, { name: "OMS" }, null);
    expect(payload.columns.find((column) => column.key === "account")).toMatchObject({
      prose: true,
    });
    expect(payload.columns.find((column) => column.key === "text:entry")).toMatchObject({
      nowrap: true,
    });
  });

  it("keeps CSV numbers raw but indents the hierarchy", () => {
    const csv = buildReportCsv(tb());
    expect(csv).toContain('"  نقدية"');
    expect(csv).toContain('"-1500.00"');
  });

  it("gives Excel the same display convention through the number format", () => {
    expect(excelNumberFormat({ key: "x", label: "x", numeric: true, negative: "minus" })).toBe(
      "#,##0.00;-#,##0.00",
    );
    expect(excelNumberFormat({ key: "x", label: "x", numeric: true, negative: "parens" })).toBe(
      "#,##0.00;(#,##0.00);0.00",
    );
    expect(excelNumberFormat({ key: "x", label: "x", numeric: true })).toBe("#,##0.00;-#,##0.00");
  });
});
