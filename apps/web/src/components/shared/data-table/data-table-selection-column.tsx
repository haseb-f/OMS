"use client";

import { TriggerChevron } from "@/components/ui/trigger-chevron";
import { useState } from "react";
import type { ColumnDef, Table } from "@tanstack/react-table";

import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/providers/locale-provider";
import { IconActionButton } from "@/components/shared/icon-action-button";
import {
  resolveSelectionScope,
  selectionScopeMessageKey,
  type MatchingSelectionSnapshot,
  type SelectionScope,
} from "./bulk-selection";
import { renderFigures } from "./data-table-pagination";

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
  /** Server mode: the last complete "select all matching" result for the current query (`useMatchingSelection`). */
  matchingSelection?: MatchingSelectionSnapshot | null;
}

/**
 * The table's current selection scope (see `resolveSelectionScope`). Server
 * mode (manual pagination) claims "all matching" only while the selection
 * equals the caller's complete "select all matching" snapshot for the
 * current query; client mode compares with the exact filtered row ids.
 */
export function getTableSelectionScope<TData>(
  table: Table<TData>,
  matchingSelection?: MatchingSelectionSnapshot | null,
): {
  scope: SelectionScope;
  count: number;
  totalMatching: number;
} {
  const selectedIds = Object.entries(table.getState().rowSelection)
    .filter(([, selected]) => selected)
    .map(([id]) => id);
  const pageRowIds = table.getRowModel().rows.map((row) => row.id);
  const totalMatching = table.getRowCount();
  const scope = resolveSelectionScope({
    selectedIds,
    pageRowIds,
    matchingSelection,
    matchingIds: table.options.manualPagination
      ? undefined
      : table.getPrePaginationRowModel().rows.map((row) => row.id),
  });
  return { scope, count: selectedIds.length, totalMatching };
}

/** "12 selected on this page" / "All 347 matching results selected" — digits isolated in `num` runs. */
export function SelectionScopeSummary({ scope, count }: { scope: SelectionScope; count: number }) {
  const { t } = useLocale();
  if (scope === "none") return null;
  return <>{renderFigures(t(selectionScopeMessageKey(scope)), { count: String(count) })}</>;
}

/** Prepended to every `EnterpriseDataTable` column list — the "Selection" checkbox column every module would otherwise redefine. Passing `menu` upgrades the header checkbox into a compact split control: the checkbox still toggles the current page, and an adjoining bordered chevron button opens the selection-scope menu. */
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
      const { scope, count, totalMatching } = getTableSelectionScope(table, menu.matchingSelection);
      return (
        <SelectionHeaderMenu
          checked={checked}
          onToggle={(value) => table.toggleAllPageRowsSelected(value)}
          onSelectPage={() => {
            // "Select this page" means exactly this page — any wider
            // selection (other pages, all matching) is replaced, never kept.
            const next: Record<string, boolean> = {};
            for (const row of table.getRowModel().rows) {
              if (row.getCanSelect()) next[row.id] = true;
            }
            table.setRowSelection(next);
          }}
          pageRowCount={table.getRowModel().rows.length}
          totalMatchingCount={totalMatching}
          scope={scope}
          selectedCount={count}
          selectAllLabel={ariaLabels.selectAll}
          menu={menu}
        />
      );
    },
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        disabled={!row.getCanSelect()}
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
  scope,
  selectedCount,
  selectAllLabel,
  menu,
}: {
  checked: boolean | "indeterminate";
  onToggle: (value: boolean) => void;
  onSelectPage: () => void;
  pageRowCount: number;
  totalMatchingCount: number;
  scope: SelectionScope;
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

  // Split control: the checkbox toggles the current page; the adjoining
  // bordered button (its own surface, hover, open and focus states) opens the
  // scope menu. Both hit areas are >= 24x24 (WCAG 2.2 2.5.8) without growing
  // the header: the 16px box extends 4px each side, the 20px button 2px, and
  // the 6px gap is exactly where the two meet — they never overlap.
  return (
    <div data-slot="selection-split" className="flex items-center gap-1.5">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onToggle(!!value)}
        aria-label={selectAllLabel}
        className="after:-inset-x-1"
      />
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <IconActionButton
            label={t("table.selectionMenuLabel")}
            variant="outline"
            tooltip={!open}
            aria-haspopup="menu"
            className="relative size-5 rounded-xs text-muted-foreground after:absolute after:-inset-0.5 not-disabled:hover:text-foreground aria-expanded:text-foreground"
          >
            <TriggerChevron kind="menu" size="sm" />
          </IconActionButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-caption font-normal text-muted-foreground">
            {scope === "none" ? (
              t("table.selectionNoneSelected")
            ) : (
              <SelectionScopeSummary scope={scope} count={selectedCount} />
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={pageRowCount === 0}
            onSelect={(event) => {
              event.preventDefault();
              runAfterClose(onSelectPage);
            }}
          >
            <span>{t("table.selectionSelectPage")}</span>
            <span className="ms-auto text-caption text-muted-foreground num">{pageRowCount}</span>
          </DropdownMenuItem>
          {menu.onSelectAllMatching && (
            <DropdownMenuItem
              disabled={menu.isSelectingAllMatching || totalMatchingCount === 0}
              onSelect={(event) => {
                event.preventDefault();
                runAfterClose(() => void menu.onSelectAllMatching?.());
              }}
            >
              <span>{t("table.selectionSelectAllFiltered")}</span>
              <span className="ms-auto text-caption text-muted-foreground num">
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
