import { downloadBlob } from "./download";

/**
 * The one report-export engine — every financial/operational report hands a
 * fully *resolved* document here (titles, headers and labels already
 * translated into the active UI language, direction already chosen), and
 * this module only serialises it. It never translates anything itself, so an
 * Arabic and an English export of the same report differ only in their text
 * and direction: numeric cells are the same raw numbers, stable references
 * (account codes, document numbers) are copied verbatim, and totals match.
 */

export type ReportExportFormat = "xlsx" | "csv";

export type ReportExportCell = string | number | null | undefined;

export interface ReportExportColumn {
  key: string;
  label: string;
  /** Numeric (money) column — written as a real number, never a formatted string. */
  numeric?: boolean;
}

export interface ReportExportRow {
  cells: Record<string, ReportExportCell>;
  /** Hierarchy depth, rendered as an Excel indent on the document's `indentKey` column. */
  level?: number;
  /** Group/subtotal/total rows are written bold. */
  emphasize?: boolean;
}

export interface ReportExportDocument {
  title: string;
  direction: "rtl" | "ltr";
  /** Label/value pairs under the title — company, period, printed at/by. */
  meta?: Array<{ id?: string; label: string; value: string }>;
  columns: ReportExportColumn[];
  /** Column that carries the hierarchy indent (defaults to the first column). */
  indentKey?: string;
  rows: ReportExportRow[];
  /** Final totals row, written bold beneath the body. */
  totals?: { label: string; cells: Record<string, ReportExportCell> };
}

const MONEY_FORMAT = "#,##0.00;-#,##0.00";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeCell(column: ReportExportColumn, value: ReportExportCell): ReportExportCell {
  if (!column.numeric) return value ?? "";
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? roundMoney(number) : value;
}

function totalsRowCells(document: ReportExportDocument): ReportExportCell[] | null {
  if (!document.totals) return null;
  const totals = document.totals;
  return document.columns.map((column, index) => {
    const value = totals.cells[column.key];
    if (index === 0 && (value === undefined || value === null || value === "")) return totals.label;
    return normalizeCell(column, value);
  });
}

function csvEscape(value: ReportExportCell): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? value.toFixed(2) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * CSV has no concept of direction, so readability of Arabic depends on the
 * leading UTF-8 BOM (without it Excel guesses the system codepage and
 * garbles the text). Numbers are plain `1234.50` — never thousands-grouped —
 * so any spreadsheet re-reads them as numbers in either language.
 */
export function buildReportCsv(document: ReportExportDocument): string {
  const lines: string[] = [csvEscape(document.title)];
  for (const item of document.meta ?? []) {
    lines.push([csvEscape(item.label), csvEscape(item.value)].join(","));
  }
  lines.push("");
  lines.push(document.columns.map((column) => csvEscape(column.label)).join(","));
  for (const row of document.rows) {
    lines.push(
      document.columns
        .map((column) => csvEscape(normalizeCell(column, row.cells[column.key])))
        .join(","),
    );
  }
  const totals = totalsRowCells(document);
  if (totals) lines.push(totals.map(csvEscape).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/**
 * Real .xlsx (not CSV-renamed): an RTL sheet view for Arabic, a font that
 * carries Arabic glyphs, money cells as numbers with a 2-decimal format, the
 * header frozen, and group/total rows bold. `exceljs` is loaded on demand so
 * it never weighs on a page until someone actually exports.
 */
export async function buildReportXlsx(document: ReportExportDocument): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const rtl = document.direction === "rtl";
  const font = { name: "Arial", size: 10 };
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OMS";
  workbook.created = new Date();
  const sheetName = document.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Report";
  const columnCount = Math.max(document.columns.length, 1);

  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ rightToLeft: rtl }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const titleRow = sheet.addRow([document.title]);
  titleRow.font = { ...font, size: 14, bold: true };
  sheet.mergeCells(titleRow.number, 1, titleRow.number, columnCount);

  for (const item of document.meta ?? []) {
    const row = sheet.addRow([item.label, item.value]);
    row.font = font;
    row.getCell(1).font = { ...font, bold: true };
  }
  sheet.addRow([]);

  const headerRow = sheet.addRow(document.columns.map((column) => column.label));
  headerRow.eachCell((cell, index) => {
    const column = document.columns[index - 1];
    cell.font = { ...font, bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FF64748B" } } };
    cell.alignment = { horizontal: column?.numeric ? "right" : rtl ? "right" : "left" };
  });
  sheet.views = [{ rightToLeft: rtl, state: "frozen", ySplit: headerRow.number }];

  const indentIndex = Math.max(
    document.columns.findIndex((column) => column.key === document.indentKey),
    0,
  );
  const writeRow = (values: ReportExportCell[], bold: boolean, level = 0) => {
    const row = sheet.addRow(values.map((value) => (value === undefined ? null : value)));
    document.columns.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      cell.font = { ...font, bold };
      if (column.numeric) cell.numFmt = MONEY_FORMAT;
      if (index === indentIndex && level > 0) cell.alignment = { indent: Math.min(level, 10) };
    });
    return row;
  };

  for (const row of document.rows) {
    writeRow(
      document.columns.map((column) => normalizeCell(column, row.cells[column.key])),
      Boolean(row.emphasize),
      row.level ?? 0,
    );
  }
  const totals = totalsRowCells(document);
  if (totals) {
    const row = writeRow(totals, true);
    row.eachCell((cell) => {
      cell.border = { top: { style: "double", color: { argb: "FF0F172A" } } };
    });
  }

  document.columns.forEach((column, index) => {
    const longest = Math.max(
      column.label.length,
      ...document.rows.map((row) => String(row.cells[column.key] ?? "").length),
    );
    sheet.getColumn(index + 1).width = column.numeric
      ? Math.max(14, column.label.length + 2)
      : Math.min(Math.max(12, longest + 2), 60);
  });

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function downloadReport(
  document: ReportExportDocument,
  format: ReportExportFormat,
  baseName: string,
): Promise<void> {
  const stem = baseName.replace(/\.(csv|xlsx)$/i, "");
  if (format === "csv") {
    downloadBlob(
      new Blob([buildReportCsv(document)], { type: "text/csv;charset=utf-8;" }),
      `${stem}.csv`,
    );
    return;
  }
  const buffer = await buildReportXlsx(document);
  downloadBlob(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${stem}.xlsx`,
  );
}
