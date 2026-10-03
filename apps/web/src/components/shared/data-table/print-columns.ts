import type { PrintColumn } from "@/types/print-engine";
import { resolveColumnLayout, type ColumnType } from "./column-engine";

/**
 * Printed-sheet geometry per column type (R6 B4) — physical widths for an
 * A4 landscape list, derived ONLY from what the column holds. Never from the
 * user's on-screen widths: a screen preference (dragged to 600px on a wide
 * monitor) would starve every other column on paper.
 *
 * Compact facts (dates, references, codes, phones, amounts, statuses) get a
 * fixed narrow width and stay on one line; text (names, descriptions,
 * defaults) is left unsized so it shares the remaining width and wraps.
 */
const PRINT_TYPE_FORMAT: Partial<
  Record<ColumnType, Pick<PrintColumn, "width" | "align" | "nowrap">>
> = {
  date: { width: "24mm", nowrap: true },
  reference: { width: "30mm", nowrap: true },
  code: { width: "26mm", nowrap: true },
  phone: { width: "32mm", nowrap: true },
  status: { width: "26mm" },
  money: { width: "30mm", align: "end", nowrap: true },
  number: { width: "20mm", align: "end", nowrap: true },
  quantity: { width: "20mm", align: "end", nowrap: true },
  percent: { width: "18mm", align: "end", nowrap: true },
};

/** The print format for one column type; text types return no width (flexible). */
export function printColumnFormat(
  type: ColumnType | undefined,
): Pick<PrintColumn, "width" | "align" | "nowrap"> {
  return { ...(type ? PRINT_TYPE_FORMAT[type] : undefined) };
}

/**
 * A print column for a table column: its key and translated label, plus the
 * type-derived width/alignment. The type is the declared `meta.type` (or the
 * same id-based inference the screen uses), so print and screen agree on
 * what a column IS while keeping independent geometry.
 */
export function toPrintColumn(
  column: { id: string; meta?: Parameters<typeof resolveColumnLayout>[1] },
  label: string,
): PrintColumn {
  const { type, align } = resolveColumnLayout(column.id, column.meta);
  const format = printColumnFormat(type);
  const printAlign = format.align ?? (align === "end" ? "end" : undefined);
  return { key: column.id, label, ...format, ...(printAlign ? { align: printAlign } : {}) };
}
