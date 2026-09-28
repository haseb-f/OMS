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
    dateRange: { from: new Date(2026, 0, 1), to: new Date(2026, 8, 30) },
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
      columns: [
        {
          key: "closing",
          labelKey: "reports.finance.fields.closingBalance",
          negative: "drcr",
        },
      ],
      footer: { values: { closing: 0 } },
      locale: "ar",
      direction: "rtl",
      t,
      companyName: "OMS",
      printedByName: null,
      currency: "EGP",
      filters: [{ id: "filter:branch", label: "الفرع", value: "القاهرة" }],
      summary: [{ id: "summary:check", label: "المدين = الدائن", value: "متوازن" }],
      drcrLabels: { debit: "مدين", credit: "دائن" },
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

  it("prints Dr/Cr sides, a dash for zero, indentation and row kinds", () => {
    const payload = toReportPrintPayload(tb(), { name: "OMS" }, null);
    expect(payload.rows.map((row) => row.closing)).toEqual([
      "—",
      "1,500.00 مدين",
      "1,500.00 دائن",
      "—",
    ]);
    expect(String(payload.rows[1]?.account).startsWith(" ")).toBe(true);
    expect(payload.rows[3]?.account).toBe(translate(messages.ar, "reports.finance.totals"));
    expect(payload.rowKinds).toEqual(["parent", "detail", "detail", "grand-total"]);
    expect(payload.orientation).toBe("landscape");
    expect(payload.subtitle).toContain("القاهرة");
    expect(payload.subtitle).toContain("EGP");
  });

  it("keeps CSV numbers raw but indents the hierarchy", () => {
    const csv = buildReportCsv(tb());
    expect(csv).toContain('"  نقدية"');
    expect(csv).toContain('"-1500.00"');
  });

  it("gives Excel the same display convention through the number format", () => {
    expect(
      excelNumberFormat(
        { key: "x", label: "x", numeric: true, negative: "drcr" },
        {
          debit: "Dr",
          credit: "Cr",
        },
      ),
    ).toBe('#,##0.00 "Dr";#,##0.00 "Cr";"—"');
    expect(excelNumberFormat({ key: "x", label: "x", numeric: true, negative: "parens" })).toBe(
      '#,##0.00;(#,##0.00);"—"',
    );
    expect(excelNumberFormat({ key: "x", label: "x", numeric: true })).toBe("#,##0.00;-#,##0.00");
  });
});
