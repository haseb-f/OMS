"use client";

import { PrintPage } from "../print-page";
import { PrintTable } from "../print-table";
import { PrintDocumentHeader, PrintMetaStrip } from "../print-blocks";
import { usePrintIdentity } from "../print-brand";
import { formatDateTime } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { GenericListPrintPayload } from "@/types/print-engine";

/**
 * Lists and financial reports (spec §3): header, the report scope as one
 * strip (period, currency, basis, every active filter — or the legacy
 * subtitle), then the full table with its hierarchy styles, subtotals and
 * final totals. A4 landscape by default; the header row repeats on every
 * sheet; the row count is stated so a reader knows the printout is complete.
 */
function ListPrintTemplate({ payload }: { payload: GenericListPrintPayload }) {
  const { t } = useLocale();
  const orientation = payload.orientation ?? "landscape";
  const density = payload.columns.length > 7 || payload.rows.length > 40 ? "compact" : "normal";
  const printedAt = formatDateTime(new Date());
  const identity = usePrintIdentity(payload.company);
  const count = payload.rows.length;

  return (
    <PrintPage
      orientation={orientation}
      direction={payload.direction}
      printedAt={printedAt}
      accentColor={identity.accentColor}
    >
      <PrintDocumentHeader
        company={identity.company}
        title={payload.title}
        number={payload.documentNumber}
        lines={[
          `${t("reportExport.printedAt")}: ${printedAt}`,
          ...(payload.printedByName
            ? [`${t("reportExport.printedBy")}: ${payload.printedByName}`]
            : []),
        ]}
      />
      {payload.meta && payload.meta.length > 0 ? (
        <PrintMetaStrip items={payload.meta} />
      ) : payload.subtitle ? (
        <div className="pr-meta-strip">
          <span>{payload.subtitle}</span>
        </div>
      ) : null}
      <div style={{ marginTop: "3mm" }}>
        <PrintTable
          columns={payload.columns}
          rows={payload.rows}
          density={density}
          rowKinds={payload.rowKinds}
        />
      </div>
      {payload.variant === "list" ? (
        <p className="pr-footnote">
          {t("printDocument.rowCount", { count })}
          {payload.totalRowCount && payload.totalRowCount > count
            ? ` / ${payload.totalRowCount}`
            : ""}
        </p>
      ) : null}
    </PrintPage>
  );
}

/** Master Data lists, Products, Warehouse/Inventory lists, Customer/Supplier lists — any plain business-data table. */
export function GenericListPrintTemplate({ payload }: { payload: GenericListPrintPayload }) {
  return <ListPrintTemplate payload={payload} />;
}

/** Accounting-style reports (General Ledger, Trial Balance, P&L, Balance Sheet, Aging, Stock Movement). */
export function ReportPrintTemplate({ payload }: { payload: GenericListPrintPayload }) {
  return <ListPrintTemplate payload={payload} />;
}
