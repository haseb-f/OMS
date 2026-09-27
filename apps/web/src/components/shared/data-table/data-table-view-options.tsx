"use client";

import type { Table } from "@tanstack/react-table";
import { ArrowLeft, ArrowRight, SlidersHorizontal } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TableDensity } from "@/components/ui/table";
import { useLocale } from "@/providers/locale-provider";

/**
 * The table's view menu: density (compact / comfortable — the visible
 * density toggle of design-system §6), then column visibility + column-order
 * arrows (TASK-060B Part 3). Arrow buttons stand in for full drag-and-drop
 * reordering while still giving every column a rememberable order.
 */
export function EnterpriseTableViewOptions<TData>({
  table,
  density,
  onDensityChange,
}: {
  table: Table<TData>;
  density?: TableDensity;
  onDensityChange?: (density: TableDensity) => void;
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
        {density && onDensityChange ? (
          <>
            <DropdownMenuLabel>{t("table.density")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={density}
              onValueChange={(value) => onDensityChange(value as TableDensity)}
            >
              <DropdownMenuRadioItem value="compact" onSelect={(event) => event.preventDefault()}>
                {t("table.densityCompact")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="comfortable"
                onSelect={(event) => event.preventDefault()}
              >
                {t("table.densityComfortable")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
