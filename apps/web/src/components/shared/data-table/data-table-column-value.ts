import type { ColumnDef } from "@tanstack/react-table";
import type { MessageKey } from "@/i18n/translate";

/**
 * A column's plain-text display value — what the cell shows, as text.
 *
 * `meta.displayValue` (translated labels) wins when the caller can translate
 * (`t`); otherwise the column's own `accessorFn` is used — the same source
 * of truth the cell renders from — so Quick Preview panels and the Print
 * Engine never maintain a second, hand-written "how do I stringify this
 * column" mapping. Pass `t` wherever the text is shown to a user (print,
 * preview): a column whose accessor returns an enum code declares
 * `displayValue` so the printout never shows the raw code.
 */
export function getColumnDisplayValue<TData>(
  column: ColumnDef<TData, unknown>,
  row: TData,
  t?: (key: MessageKey) => string,
): string {
  const display = column.meta?.displayValue;
  const value =
    display && t
      ? display(row, t)
      : (column as { accessorFn?: (row: TData) => unknown }).accessorFn?.(row);
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "✓" : "—";
  return String(value);
}
