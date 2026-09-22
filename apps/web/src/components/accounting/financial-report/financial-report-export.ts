import type { Locale } from "@/i18n/locales";
import type { MessageKey } from "@/i18n/translate";
import { formatDateRange, formatDateTime } from "@/lib/date";
import type { ReportExportDocument } from "@/lib/report-export";
import type { GenericListPrintPayload, PrintCompanyInfo } from "@/types/print-engine";
import { resolveFinancialLineLabel } from "./line-label";
import type {
  FinancialReportColumn,
  FinancialReportFooter,
  FinancialReportLine,
  FinancialReportLineKind,
  FinancialReportTextColumn,
} from "./types";

const EMPHASIZED_KINDS = new Set<FinancialReportLineKind>([
  "section",
  "group",
  "subtotal",
  "section_total",
  "opening",
  "closing",
  "grand_total",
  "result",
]);

export interface FinancialReportExportInput {
  title: string;
  /** Already-visible (expanded) lines, in display order. */
  lines: FinancialReportLine[];
  columns: FinancialReportColumn[];
  /** Descriptive columns (date, entry, partner…) exported as text. */
  textColumns?: FinancialReportTextColumn[];
  footer?: FinancialReportFooter;
  locale: Locale;
  direction: "rtl" | "ltr";
  t: (key: MessageKey) => string;
  nameHeaderKey?: MessageKey;
  companyName: string;
  printedByName: string | null;
  dateRange?: { from: Date | null; to: Date | null };
  printedAt?: Date;
}

/**
 * Builds the language-resolved export document for any Financial Report
 * (Trial Balance, P&L, Balance Sheet, Cash Flow, GL, statements, aging) —
 * the same one the Excel, CSV and print outputs are all rendered from, so
 * their headings, line labels and totals can never drift apart.
 */
export function buildFinancialReportDocument(
  input: FinancialReportExportInput,
): ReportExportDocument {
  const { t } = input;
  const period = input.dateRange ? formatDateRange(input.dateRange.from, input.dateRange.to) : "";
  return {
    title: input.title,
    direction: input.direction,
    meta: [
      { id: "company", label: t("reportExport.company"), value: input.companyName },
      {
        id: "period",
        label: t("reportExport.period"),
        value: period || t("reportExport.allDates"),
      },
      {
        id: "printedAt",
        label: t("reportExport.printedAt"),
        value: formatDateTime(input.printedAt ?? new Date()),
      },
      ...(input.printedByName
        ? [{ id: "printedBy", label: t("reportExport.printedBy"), value: input.printedByName }]
        : []),
    ],
    columns: [
      { key: "code", label: t("reports.finance.fields.accountCode") },
      { key: "account", label: t(input.nameHeaderKey ?? "reports.finance.fields.accountName") },
      ...(input.textColumns ?? []).map((column) => ({
        key: `text:${column.key}`,
        label: t(column.labelKey as MessageKey),
      })),
      ...input.columns.map((column) => ({
        key: column.key,
        label: t(column.labelKey as MessageKey),
        numeric: true,
      })),
    ],
    indentKey: "account",
    rows: input.lines
      .filter((line) => line.kind !== "spacer")
      .map((line) => ({
        level: Math.max(line.level, 0),
        emphasize: EMPHASIZED_KINDS.has(line.kind),
        cells: {
          code: line.code ?? "",
          account: resolveFinancialLineLabel(line, input.locale, t),
          ...Object.fromEntries(
            (input.textColumns ?? []).map((column) => [
              `text:${column.key}`,
              line.text?.[column.key] ?? "",
            ]),
          ),
          ...Object.fromEntries(
            input.columns.map((column) => [column.key, line.values[column.key] ?? 0]),
          ),
        },
      })),
    totals: input.footer
      ? { label: t("reports.finance.totals"), cells: { ...input.footer.values } }
      : undefined,
  };
}

function formatAmount(value: unknown): string {
  if (typeof value !== "number") return value == null ? "" : String(value);
  // Latin digits in both languages — money must read identically in the
  // Arabic and English print of the same report.
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The print layout of the same export document (report variant, landscape). */
export function toReportPrintPayload(
  document: ReportExportDocument,
  company: PrintCompanyInfo,
  printedByName: string | null,
): GenericListPrintPayload {
  const numericKeys = new Set(document.columns.filter((c) => c.numeric).map((c) => c.key));
  const toRow = (cells: Record<string, unknown>) =>
    Object.fromEntries(
      document.columns.map((column) => [
        column.key,
        numericKeys.has(column.key)
          ? formatAmount(cells[column.key] ?? 0)
          : String(cells[column.key] ?? ""),
      ]),
    );
  const rows = document.rows.map((row) => toRow(row.cells));
  if (document.totals) {
    const firstKey = document.columns[0]?.key;
    rows.push(
      toRow({
        ...(firstKey ? { [firstKey]: document.totals.label } : {}),
        ...document.totals.cells,
      }),
    );
  }
  return {
    variant: "report",
    title: document.title,
    // Company and printed at/by already sit in the shared print header.
    subtitle: (document.meta ?? [])
      .filter((item) => item.id === "period")
      .map((item) => `${item.label}: ${item.value}`)
      .join("  ·  "),
    direction: document.direction,
    company,
    printedByName,
    columns: document.columns.map((column) => ({
      key: column.key,
      label: column.label,
      align: column.numeric ? ("end" as const) : ("start" as const),
    })),
    rows,
  };
}
