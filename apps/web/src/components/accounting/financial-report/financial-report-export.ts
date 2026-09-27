import type { Locale } from "@/i18n/locales";
import { localeLabel } from "@/i18n/locales";
import type { MessageKey } from "@/i18n/translate";
import { formatDateRange, formatDateTime } from "@/lib/date";
import { formatAmount } from "@/lib/money";
import type { ReportExportDocument, ReportExportRowKind } from "@/lib/report-export";
import type { GenericListPrintPayload, PrintCompanyInfo } from "@/types/print-engine";
import { resolveFinancialLineLabel } from "./line-label";
import {
  displayAmount,
  resolveRowKinds,
  type FinancialReportColumn,
  type FinancialReportFooter,
  type FinancialReportLine,
  type FinancialReportRowKind,
  type FinancialReportTextColumn,
} from "./types";

export interface FinancialReportExportInput {
  title: string;
  /** Already-visible (expanded) lines, in display order. */
  lines: FinancialReportLine[];
  /** Presentation kind per line id (from `resolveRowKinds` on the full tree). */
  rowKinds?: Map<string, FinancialReportRowKind>;
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
  /** Overrides the period text (e.g. "As of 30 Sep 2026" for point-in-time reports). */
  period?: string;
  /** Report currency (ISO code). */
  currency?: string;
  /** Every active filter, already resolved to display text. */
  filters?: Array<{ id: string; label: string; value: string }>;
  /** Summary tiles + balance check, already formatted (`summaryToText`). */
  summary?: Array<{ id: string; label: string; value: string }>;
  /** Localized Dr/Cr side labels for `drcr` columns. */
  drcrLabels?: { debit: string; credit: string };
  printedAt?: Date;
}

const EMPHASIZED_ROW_KINDS = new Set<FinancialReportRowKind>([
  "section",
  "parent",
  "subtotal",
  "grand-total",
]);

/**
 * Builds the language-resolved export document for any Financial Report
 * (Trial Balance, P&L, Balance Sheet, Cash Flow, GL, statements, aging) —
 * the same one the Excel, CSV and print outputs are all rendered from, so
 * their headings, line labels, scope (filters), summary and totals can never
 * drift apart.
 */
export function buildFinancialReportDocument(
  input: FinancialReportExportInput,
): ReportExportDocument {
  const { t } = input;
  const period =
    input.period ??
    (input.dateRange ? formatDateRange(input.dateRange.from, input.dateRange.to) : "");
  const rowKinds = input.rowKinds ?? resolveRowKinds(input.lines, { hasFooter: !!input.footer });
  const exportedIds = new Set(input.lines.map((line) => line.id));
  return {
    title: input.title,
    direction: input.direction,
    drcrLabels: input.drcrLabels,
    meta: [
      { id: "company", label: t("reportExport.company"), value: input.companyName },
      {
        id: "period",
        label: t("reportExport.period"),
        value: period || t("reportExport.allDates"),
      },
      ...(input.currency
        ? [{ id: "currency", label: t("reportExport.currency"), value: input.currency }]
        : []),
      { id: "language", label: t("reportExport.language"), value: localeLabel[input.locale] },
      ...(input.filters ?? []),
      ...(input.summary ?? []),
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
        negative: column.negative ?? "minus",
      })),
    ],
    indentKey: "account",
    rows: input.lines
      .filter((line) => line.kind !== "spacer")
      .map((line) => {
        const kind: ReportExportRowKind = rowKinds.get(line.id) ?? "detail";
        // As on screen: an expanded section's figures are stated once, by its
        // total row — the heading itself carries no amounts.
        const headingOnly =
          kind === "section" && line.children.some((child) => exportedIds.has(child.id));
        return {
          id: line.id,
          level: Math.max(line.level, 0),
          kind,
          emphasize: EMPHASIZED_ROW_KINDS.has(kind),
          cells: {
            code: line.code ?? "",
            account: resolveFinancialLineLabel(line, input.locale, t),
            ...Object.fromEntries(
              (input.textColumns ?? []).map((column) => [
                `text:${column.key}`,
                line.text?.[column.key] ?? "",
              ]),
            ),
            // Raw numbers (a missing value stays blank, never a fake 0).
            ...Object.fromEntries(
              input.columns.map((column) => [
                column.key,
                headingOnly ? undefined : line.values[column.key],
              ]),
            ),
          },
        };
      }),
    totals: input.footer
      ? {
          label: t("reports.finance.totals"),
          labelKey: "account",
          cells: { ...input.footer.values },
        }
      : undefined,
  };
}

/** Non-breaking indent for print (plain spaces collapse in HTML). */
const PRINT_INDENT = "   ";

/**
 * The print layout of the same export document (report variant, landscape).
 * Amounts use `formatAmount` with each column's convention — the same text
 * as the screen (Latin digits, "—" for zero, Dr/Cr sides). The subtitle
 * states the report's full scope: period, currency, language, every active
 * filter, the summary figures and the balance check.
 */
export function toReportPrintPayload(
  document: ReportExportDocument,
  company: PrintCompanyInfo,
  printedByName: string | null,
): GenericListPrintPayload {
  const columnsByKey = new Map(document.columns.map((column) => [column.key, column]));
  const indentKey = document.indentKey ?? document.columns[0]?.key;
  const toRow = (cells: Record<string, unknown>, rowId?: string, level = 0) =>
    Object.fromEntries(
      document.columns.map((column) => {
        const raw = cells[column.key];
        if (columnsByKey.get(column.key)?.numeric) {
          if (raw === undefined || raw === null || raw === "") return [column.key, ""];
          const shown = rowId
            ? displayAmount({ id: rowId, values: { v: Number(raw) } }, "v").value
            : Number(raw);
          return [
            column.key,
            formatAmount(shown, {
              negative: column.negative ?? "minus",
              zero: "dash",
              drcrLabels: document.drcrLabels,
            }),
          ];
        }
        const text = String(raw ?? "");
        return [
          column.key,
          column.key === indentKey && level > 0 && text
            ? `${PRINT_INDENT.repeat(Math.min(level, 10))}${text}`
            : text,
        ];
      }),
    );
  const rows = document.rows.map((row) => toRow(row.cells, row.id, row.level ?? 0));
  const rowKinds: ReportExportRowKind[] = document.rows.map((row) => row.kind ?? "detail");
  if (document.totals) {
    const labelKey = document.totals.labelKey ?? document.columns[0]?.key;
    rows.push(
      toRow({
        ...document.totals.cells,
        ...(labelKey ? { [labelKey]: document.totals.label } : {}),
      }),
    );
    rowKinds.push("grand-total");
  }
  const HEADER_IDS = new Set(["company", "printedAt", "printedBy"]);
  return {
    variant: "report",
    title: document.title,
    orientation: "landscape",
    // Company and printed at/by already sit in the shared print header.
    subtitle: (document.meta ?? [])
      .filter((item) => !HEADER_IDS.has(item.id ?? ""))
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
    rowKinds,
  };
}
