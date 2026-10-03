"use client";

import type { Table } from "@tanstack/react-table";
import { ArrowLeft, ArrowRight, MoveHorizontal, SlidersHorizontal } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/providers/locale-provider";

/**
 * The table's column menu: visibility + column-order arrows (TASK-060B
 * Part 3). Arrow buttons stand in for full drag-and-drop reordering while
 * still giving every column a rememberable order. Row density is its own
 * toolbar control (`EnterpriseTableDensityControl`), not a column setting.
 */
export function EnterpriseTableViewOptions<TData>({
  table,
  onResetColumnWidths,
}: {
  table: Table<TData>;
  /** "Reset column widths" — omit (or pass undefined) while no column has a custom width. */
  onResetColumnWidths?: () => void;
}) {
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
        <EnterpriseButton
          variant="outline"
          size="sm"
          className="gap-1.5"
          aria-label={t("table.columns")}
        >
          <SlidersHorizontal className="size-3.5" />
          {/* Icon-only in a narrow table container; the aria-label keeps the name. */}
          <span className="hidden @3xl/enterprise-table:inline">{t("table.columns")}</span>
        </EnterpriseButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t("table.columns")}</DropdownMenuLabel>
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
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("table.moveColumnStart")}
                className="text-muted-foreground/60"
                onClick={(event) => {
                  event.preventDefault();
                  moveColumn(column.id, -1);
                }}
              >
                <ArrowLeft className="size-3 rtl:rotate-180" />
              </EnterpriseButton>
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("table.moveColumnEnd")}
                className="text-muted-foreground/60"
                onClick={(event) => {
                  event.preventDefault();
                  moveColumn(column.id, 1);
                }}
              >
                <ArrowRight className="size-3 rtl:rotate-180" />
              </EnterpriseButton>
            </div>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!onResetColumnWidths} onSelect={() => onResetColumnWidths?.()}>
          <MoveHorizontal aria-hidden />
          {t("controls.table.resetColumnWidths")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
