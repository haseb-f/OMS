import type { ColumnDef } from "@tanstack/react-table";

/**
 * Extracts a column's plain-text display value straight from its own
 * `accessorFn` — the same source of truth the table cell itself renders
 * from, so Quick Preview panels and the Print Engine never maintain a
 * second, hand-written "how do I stringify this column" mapping.
 */
export function getColumnDisplayValue<TData>(
  column: ColumnDef<TData, unknown>,
  row: TData,
): string {
  const accessorFn = (column as { accessorFn?: (row: TData) => unknown }).accessorFn;
  const value = accessorFn ? accessorFn(row) : undefined;
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "✓" : "—";
  return String(value);
}
