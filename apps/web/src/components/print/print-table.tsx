import { cn } from "@/lib/utils";
import type { GenericListPrintPayload, PrintColumn } from "@/types/print-engine";

type PrintRowKind = NonNullable<GenericListPrintPayload["rowKinds"]>[number];

/**
 * Report hierarchy styling (from the report builder's `rowKinds`): weight and
 * rules only — no fills, no zebra. Indentation is already in the cell text.
 */
const rowKindClass: Record<PrintRowKind, string> = {
  section: "font-semibold [&>td]:border-t [&>td]:border-t-border-strong",
  parent: "font-medium",
  detail: "",
  subtotal: "font-semibold [&>td]:border-t [&>td]:border-t-border-strong",
  "grand-total":
    "font-semibold [&>td]:border-t-[3px] [&>td]:border-double [&>td]:border-t-foreground",
};

const alignClass: Record<NonNullable<PrintColumn["align"]>, string> = {
  start: "text-start",
  center: "text-center",
  end: "text-end",
};

/**
 * The one printable table every module renders through — a real
 * `<table>`/`<thead>` (never a scrollable div) so the browser repeats the
 * header row on every printed page and paginates rows itself; rows never
 * split across pages (`PrintPage` sets `break-inside: avoid` on `tr`).
 * Numeric (`end`) cells render their value as an isolated LTR run with
 * tabular digits, aligned to the logical end. An optional `totalRow` is the
 * last body row (not a `<tfoot>`, which Chrome would repeat on every page).
 */
export function PrintTable({
  columns,
  rows,
  density = "normal",
  totalRow,
  rowKinds,
}: {
  columns: PrintColumn[];
  rows: Record<string, string>[];
  /** Auto-picked by callers once a table has many columns, so text shrinks instead of overflowing the printable width. */
  density?: "normal" | "compact";
  totalRow?: Record<string, string>;
  /** One kind per row (financial reports) — section / parent / detail / subtotal / grand-total. */
  rowKinds?: PrintRowKind[];
}) {
  const cellPadding = density === "compact" ? "px-1.5 py-1" : "px-2 py-1.5";
  const fontSize = density === "compact" ? "text-[9.5px]" : "text-[10.5px]";

  const cell = (column: PrintColumn, value: string | undefined) =>
    column.align === "end" ? <span className="num">{value ?? ""}</span> : (value ?? "");

  return (
    <table className={cn("w-full table-auto border-collapse leading-normal", fontSize)}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={cn(
                cellPadding,
                "border-y border-border-strong bg-surface-sunken font-semibold text-foreground",
                alignClass[column.align ?? "start"],
              )}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr
            key={index}
            className={rowKinds ? rowKindClass[rowKinds[index] ?? "detail"] : undefined}
          >
            {columns.map((column) => (
              <td
                key={column.key}
                className={cn(
                  cellPadding,
                  "border-b border-border align-top",
                  alignClass[column.align ?? "start"],
                )}
              >
                {cell(column, row[column.key])}
              </td>
            ))}
          </tr>
        ))}
        {totalRow && (
          <tr>
            {columns.map((column) => (
              <td
                key={column.key}
                className={cn(
                  cellPadding,
                  "border-t-2 border-b border-border-strong bg-surface-sunken font-semibold",
                  alignClass[column.align ?? "start"],
                )}
              >
                {cell(column, totalRow[column.key])}
              </td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
  );
}
