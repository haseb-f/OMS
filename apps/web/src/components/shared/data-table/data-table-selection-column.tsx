"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

/**
 * Generic bulk-selection-scope menu (TASK-064) — omitted entirely falls back
 * to a plain checkbox, so every other `EnterpriseDataTable` caller is
 * unaffected. "Select current page" and "clear" need nothing from the
 * caller (pure TanStack row-model operations); "select all matching" and
 * "select a specific number" are opt-in per callback, since they require a
 * caller-side query (server `listIds`, or an in-memory filtered set).
 */
export interface SelectionMenuConfig {
  onSelectAllMatching?: () => void | Promise<void>;
  isSelectingAllMatching?: boolean;
  onRequestCustomCount?: () => void;
  onClearSelection: () => void;
}

/** Prepended to every `EnterpriseDataTable` column list — the "Selection" checkbox column every module would otherwise redefine. Passing `menu` upgrades the header checkbox into a compact split control: the checkbox still toggles the current page, and an adjoining chevron opens the selection-scope menu. */
export function createSelectionColumn<TData>(
  ariaLabels: { selectAll: string; selectRow: string },
  menu?: SelectionMenuConfig,
): ColumnDef<TData, unknown> {
  return {
    id: "select",
    header: ({ table }) => {
      const checked =
        table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate");
      if (!menu) {
        return (
          <Checkbox
            checked={checked}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label={ariaLabels.selectAll}
          />
        );
      }
      return (
        <SelectionHeaderMenu
          checked={checked}
          onToggle={(value) => table.toggleAllPageRowsSelected(value)}
          onSelectPage={() => table.toggleAllPageRowsSelected(true)}
          pageRowCount={table.getRowModel().rows.length}
          totalMatchingCount={table.getRowCount()}
          selectedCount={Object.keys(table.getState().rowSelection).length}
          selectAllLabel={ariaLabels.selectAll}
          menu={menu}
        />
      );
    },
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

function SelectionHeaderMenu({
  checked,
  onToggle,
  onSelectPage,
  pageRowCount,
  totalMatchingCount,
  selectedCount,
  selectAllLabel,
  menu,
}: {
  checked: boolean | "indeterminate";
  onToggle: (value: boolean) => void;
  onSelectPage: () => void;
  pageRowCount: number;
  totalMatchingCount: number;
  selectedCount: number;
  selectAllLabel: string;
  menu: SelectionMenuConfig;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);

  // Closing the menu and firing an action (opening a Dialog, an async
  // fetch) on the same pointer event can dismiss a just-opened Dialog
  // immediately — same defer-after-close pattern as `RowActionsMenu`.
  const runAfterClose = (action: () => void) => {
    setOpen(false);
    window.setTimeout(action, 50);
  };

  return (
    <div className="flex items-center justify-center gap-0.5">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onToggle(!!value)}
        aria-label={selectAllLabel}
      />
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("table.selectionMenuLabel")}
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-xs text-muted-foreground outline-none",
              "transition-colors duration-(--duration-base) hover:bg-muted hover:text-foreground",
              "focus-visible:ring-2 focus-visible:ring-ring/60",
            )}
          >
            <ChevronDown className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              runAfterClose(onSelectPage);
            }}
          >
            <span>{t("table.selectionSelectPage")}</span>
            <span className="ms-auto text-caption text-muted-foreground tabular-nums">
              {pageRowCount}
            </span>
          </DropdownMenuItem>
          {menu.onSelectAllMatching && (
            <DropdownMenuItem
              disabled={menu.isSelectingAllMatching}
              onSelect={(event) => {
                event.preventDefault();
                runAfterClose(() => void menu.onSelectAllMatching?.());
              }}
            >
              <span>{t("table.selectionSelectAllFiltered")}</span>
              <span className="ms-auto text-caption text-muted-foreground tabular-nums">
                {totalMatchingCount}
              </span>
            </DropdownMenuItem>
          )}
          {menu.onRequestCustomCount && (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                runAfterClose(menu.onRequestCustomCount!);
              }}
            >
              {t("table.selectionSelectCustomCount")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={selectedCount === 0}
            onSelect={(event) => {
              event.preventDefault();
              runAfterClose(menu.onClearSelection);
            }}
          >
            {t("common.clearSelection")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
