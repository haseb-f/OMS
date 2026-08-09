import type { ColumnDef } from "@tanstack/react-table";
import { getColumnDisplayValue } from "@/components/shared/data-table";

/** TASK-047 Financial Reports — shared across all 4 tabs on this page. */

export function MoneyCell({ value }: { value: number }) {
  return (
    <span dir="ltr" className="tabular-nums">
      {value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}

/** Builds CSV/print export rows straight from each tab's own `accessorFn` — never a second hand-written mapping. */
export function toExportRows<TRow>(
  columns: ColumnDef<TRow, unknown>[],
  rows: TRow[],
): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(columns.map((column) => [column.id!, getColumnDisplayValue(column, row)])),
  );
}
