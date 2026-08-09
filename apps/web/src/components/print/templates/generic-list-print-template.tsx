import { PrintPage } from "../print-page";
import { PrintCompanyHeader } from "../print-company-header";
import { PrintFooter } from "../print-footer";
import { PrintTable } from "../print-table";
import { formatDateTime } from "@/lib/date";
import type { GenericListPrintPayload } from "@/types/print-engine";

/**
 * Backs both `GenericListPrintTemplate` and `ReportPrintTemplate` — a
 * Master Data list, a Products list, and an accounting report (General
 * Ledger, Trial Balance, Aging, ...) are all "a table of business rows
 * under a company header," so they share this one renderer rather than
 * two near-identical templates.
 */
function ListPrintTemplate({ payload }: { payload: GenericListPrintPayload }) {
  const orientation = payload.orientation ?? "landscape";
  const density = payload.columns.length > 7 ? "compact" : "normal";
  const printedAt = formatDateTime(new Date());

  return (
    <PrintPage orientation={orientation}>
      <PrintCompanyHeader
        company={payload.company}
        title={payload.title}
        documentNumber={payload.documentNumber}
        printedByName={payload.printedByName}
        printedAt={printedAt}
      />
      {payload.subtitle && (
        <p className="mt-2 mb-1 text-[10px] text-slate-500">{payload.subtitle}</p>
      )}
      <div className="mt-3">
        <PrintTable columns={payload.columns} rows={payload.rows} density={density} />
      </div>
      <PrintFooter printedAt={printedAt} />
    </PrintPage>
  );
}

/** Master Data lists, Products, Warehouse/Inventory lists, Customer/Supplier lists — any plain business-data table. */
export function GenericListPrintTemplate({ payload }: { payload: GenericListPrintPayload }) {
  return <ListPrintTemplate payload={payload} />;
}

/** Accounting-style reports (General Ledger, Trial Balance, P&L, Balance Sheet, Aging, Stock Movement). Same layout — reports are landscape lists of business rows too. */
export function ReportPrintTemplate({ payload }: { payload: GenericListPrintPayload }) {
  return <ListPrintTemplate payload={payload} />;
}
