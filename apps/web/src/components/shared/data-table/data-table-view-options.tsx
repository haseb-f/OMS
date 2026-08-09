"use client";

import type { Table } from "@tanstack/react-table";
import { ArrowLeft, ArrowRight, SlidersHorizontal } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/providers/locale-provider";

/** Column-visibility toggle + column-order arrows — "Column Visibility" and the reorder part of the Enterprise Data Grid spec (TASK-060B Part 3). Arrow buttons stand in for full drag-and-drop reordering (no new drag-and-drop dependency added) while still giving every column a rememberable order. */
export function EnterpriseTableViewOptions<TData>({ table }: { table: Table<TData> }) {
  const { t } = useLocale();
  const orderableColumns = table.getAllLeafColumns().filter((column) => column.getCanHide());

  const moveColumn = (columnId: string, direction: -1 | 1) => {
    const order = table.getAllLeafColumns().map((column) => column.id);
    const index = order.indexOf(columnId);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= order.length) return;
    [order[index], order[targetIndex]] = [order[targetIndex], order[index]];
    table.setColumnOrder(order);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <EnterpriseButton variant="outline" size="sm" className="gap-1.5">
          <SlidersHorizontal className="size-3.5" />
          {t("table.columns")}
        </EnterpriseButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t("table.columns")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {orderableColumns.map((column) => {
          const titleKey = column.columnDef.meta?.titleKey;
          const header = column.columnDef.header;
          const label = titleKey ? t(titleKey) : typeof header === "string" ? header : column.id;
          return (
            <div key={column.id} className="flex items-center gap-1 px-1">
              <DropdownMenuCheckboxItem
                checked={column.getIsVisible()}
                onCheckedChange={(value) => column.toggleVisibility(!!value)}
                onSelect={(event) => event.preventDefault()}
                className="flex-1"
              >
                {label}
              </DropdownMenuCheckboxItem>
              <button
                type="button"
                aria-label={t("table.moveColumnStart")}
                className="rounded p-1 text-muted-foreground/60 hover:bg-accent hover:text-foreground"
                onClick={(event) => {
                  event.preventDefault();
                  moveColumn(column.id, -1);
                }}
              >
                <ArrowLeft className="size-3" />
              </button>
              <button
                type="button"
                aria-label={t("table.moveColumnEnd")}
                className="rounded p-1 text-muted-foreground/60 hover:bg-accent hover:text-foreground"
                onClick={(event) => {
                  event.preventDefault();
                  moveColumn(column.id, 1);
                }}
              >
                <ArrowRight className="size-3" />
              </button>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
