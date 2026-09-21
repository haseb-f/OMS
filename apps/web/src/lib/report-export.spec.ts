// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";
import type { Locale } from "@/i18n/locales";
import { buildFinancialReportDocument } from "@/components/accounting/financial-report/financial-report-export";
import type { FinancialReportLine } from "@/components/accounting/financial-report/types";
import { buildReportCsv, buildReportXlsx } from "./report-export";

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
