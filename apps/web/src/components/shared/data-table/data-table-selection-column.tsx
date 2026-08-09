import type { ColumnDef } from "@tanstack/react-table";
import { Checkbox } from "@/components/ui/checkbox";

/** Prepended to every `EnterpriseDataTable` column list — the "Selection" checkbox column every module would otherwise redefine. */
export function createSelectionColumn<TData>(ariaLabels: {
  selectAll: string;
  selectRow: string;
}): ColumnDef<TData, unknown> {
  return {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label={ariaLabels.selectAll}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label={ariaLabels.selectRow}
      />
    ),
    enableSorting: false,
    enableHiding: false,
  };
}
