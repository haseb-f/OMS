import { cn } from "@/lib/utils";
import type { PrintColumn } from "@/types/print-engine";

const alignClass: Record<NonNullable<PrintColumn["align"]>, string> = {
  start: "text-start",
  center: "text-center",
  end: "text-end tabular-nums",
};

/**
 * The one printable table every module renders through — dark header,
 * alternating rows, full borders, and a real `<table>`/`<thead>` (never a
 * scrollable div) so the browser repeats the header row natively on every
 * printed page and paginates rows itself instead of clipping overflow.
 * `print-color-adjust: exact` forces the header/zebra backgrounds to
 * survive printing regardless of the browser's own "background graphics"
 * setting.
 */
export function PrintTable({
  columns,
  rows,
  density = "normal",
}: {
  columns: PrintColumn[];
  rows: Record<string, string>[];
  /** Auto-picked by callers once a table has many columns, so text shrinks instead of overflowing the printable width. */
  density?: "normal" | "compact";
}) {
  const cellPadding = density === "compact" ? "px-1.5 py-1" : "px-2 py-1.5";
  const fontSize = density === "compact" ? "text-[9px]" : "text-[10.5px]";

  return (
    <table
      className={cn("w-full table-auto border-collapse", fontSize)}
      style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
    >
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              className={cn(
                cellPadding,
                "border border-slate-800 bg-slate-800 font-semibold text-white",
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
          <tr key={index} className={cn("break-inside-avoid", index % 2 === 1 && "bg-slate-100")}>
            {columns.map((column) => (
              <td
                key={column.key}
                className={cn(
                  cellPadding,
                  "border border-slate-300",
                  alignClass[column.align ?? "start"],
                )}
              >
                {row[column.key] ?? ""}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
