"use client";

import type { Table } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { useLocale } from "@/providers/locale-provider";

/**
 * Sort control for the Grid view, which has no column headers to click. It
 * drives the very same TanStack sorting state as the headers (server-side in
 * server mode), so switching views never changes the order. Choosing the
 * column that is already sorted flips its direction.
 */
export function EnterpriseTableSortMenu<TData>({ table }: { table: Table<TData> }) {
  const { t } = useLocale();
  const sortable = table.getAllLeafColumns().filter((column) => column.getCanSort());
  if (sortable.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconActionButton label={t("tableViews.sort.label")}>
          <ArrowUpDown className="size-4" />
        </IconActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t("tableViews.sort.label")}</DropdownMenuLabel>
        {sortable.map((column) => {
          const titleKey = column.columnDef.meta?.titleKey;
          const header = column.columnDef.header;
          const label = titleKey ? t(titleKey) : typeof header === "string" ? header : column.id;
          const sorted = column.getIsSorted();
          return (
            <DropdownMenuItem
              key={column.id}
              data-checked={sorted || undefined}
              onSelect={() => column.toggleSorting(sorted ? sorted === "asc" : false, false)}
            >
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {sorted === "asc" ? (
                <ArrowUp
                  className="size-4 text-primary"
                  aria-label={t("tableViews.sort.ascending")}
                />
              ) : sorted === "desc" ? (
                <ArrowDown
                  className="size-4 text-primary"
                  aria-label={t("tableViews.sort.descending")}
                />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
