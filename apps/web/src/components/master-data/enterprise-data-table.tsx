"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, Inbox, Printer, RefreshCw, RotateCcw, Rows3, Upload } from "lucide-react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnOrderState,
  type ColumnPinningState,
  type RowSelectionState,
  type SortingState,
  type Updater,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportDialog, type ExportColumn } from "@/components/shared/export-dialog";
import { ImportDialog } from "@/components/shared/import-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  EnterpriseTableColumnHeader,
  EnterprisePagination,
  EnterpriseTableViewOptions,
  createSelectionColumn,
  getColumnDisplayValue,
  resolveColumnLayout,
  columnWidthPercent,
  responsiveHideClass,
} from "@/components/shared/data-table";
import { useLocale } from "@/providers/locale-provider";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/config/site";
import { toast } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";

/** Sane resize bounds when a column has no declared min/max in the Smart Column Engine. */
const MIN_COLUMN_WIDTH = 60;
const MAX_COLUMN_WIDTH = 640;

export type SortOrder = "asc" | "desc";
export type TableDensity = "comfortable" | "compact";

const alignClass: Record<"start" | "center" | "end", string> = {
  start: "text-start",
  center: "text-center",
  end: "text-end tabular-nums",
};

/** Derives the { key, label } list an `ExportDialog` needs from a table's own column config — never a second, hand-maintained label list. */
export function exportColumnsFromKeys<TData>(
  columns: ColumnDef<TData, unknown>[],
  keys: string[],
  t: (key: MessageKey) => string,
): ExportColumn[] {
  return keys.map((key) => {
    const column = columns.find((c) => c.id === key);
    const titleKey = column?.meta?.titleKey;
    return { key, label: titleKey ? t(titleKey) : key };
  });
}

/**
 * The ONE table every module in OMS renders through (TASK-034) — Master
 * Data, Products, Inventory, and every future list/report. It runs in
 * either of two modes depending on which props a caller passes, but both
 * modes render the identical toolbar/header/row/pagination UI, so a user
 * can never tell which one a given page uses:
 *
 * - Server mode (Master Data, Products): pass `totalCount`/`page`/
 *   `onPageChange`/`sortBy`/`onSortChange`/`search`/`onSearchChange` —
 *   `data` is just the current page, already filtered/sorted by the
 *   backend (`/:entity?search=&page=&sortBy=`).
 * - Client mode (everything else): omit all of the above — `data` is the
 *   FULL dataset and the table paginates/sorts/filters it in memory via
 *   TanStack's own row models, exactly like the old `<DataTable>` did
 *   before it was retired in favor of this one component.
 */
export function EnterpriseDataTable<TData>({
  columns,
  data,
  totalCount,
  page,
  pageSize = 20,
  onPageChange,
  onPageSizeChange,
  sortBy,
  sortOrder = "asc",
  onSortChange,
  search,
  onSearchChange,
  isLoading,
  rowSelection,
  onRowSelectionChange,
  bulkActions,
  onSelectAllMatching,
  isSelectingAllMatching,
  exportColumns,
  onExport,
  onImport,
  onRefresh,
  tableId,
  printTitle,
  emptyTitle,
  getRowId,
}: {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  /** Server mode only — omit together with page/onPageChange/etc. to run in client mode. */
  totalCount?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  sortBy?: string;
  sortOrder?: SortOrder;
  onSortChange?: (sortBy: string, sortOrder: SortOrder) => void;
  search?: string;
  onSearchChange?: (value: string) => void;
  isLoading?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (next: RowSelectionState) => void;
  bulkActions?: ReactNode;
  /**
   * Server mode only — called when the user asks to extend selection from
   * "every row on this page" to "every row matching the current filters"
   * (server-side; the caller fetches just the matching IDs, never the full
   * records, and merges them into `rowSelection`). Omit to hide the
   * affordance entirely — e.g. for a table with no bulk actions at all.
   */
  onSelectAllMatching?: () => void | Promise<void>;
  /** Shows a loading state on the "select all matching" affordance while `onSelectAllMatching` is in flight. */
  isSelectingAllMatching?: boolean;
  /** Columns offered in the Export dialog's picker — omit to hide the Export button entirely. */
  exportColumns?: ExportColumn[];
  /** Foundation only — exports the current page's visible rows for the columns the user kept checked. */
  onExport?: (selectedKeys: string[]) => void;
  /** Opt-in — no Master Data entity has a real bulk-import endpoint yet, so this only renders an Import button when a caller supplies one. */
  onImport?: (rows: Record<string, string>[]) => Promise<void> | void;
  /** Manual reload — omit to hide the Refresh button. */
  onRefresh?: () => void;
  tableId: string;
  /** Title the Print Engine's document header shows — e.g. "Products List". Falls back to `tableId` when omitted. */
  printTitle?: string;
  /** Overrides the empty-state message — falls back to the generic "No results." copy. */
  emptyTitle?: string;
  /** Row identity for stable selection across sorts/pagination. Defaults to `row.id` when present, otherwise the row's index — pass this for rows with no natural single-field id (e.g. a report keyed by product+warehouse). */
  getRowId?: (row: TData, index: number) => string;
}) {
  const { t, direction } = useLocale();
  const { printList } = usePrintEngine();
  const { activeCompany } = useCompany();
  const { user } = useUserContext();
  const [columnVisibility, setColumnVisibility] = useLocalStorage<VisibilityState>(
    `oms.table.${tableId}.columnVisibility`,
    {},
  );
  const [density, setDensity] = useLocalStorage<TableDensity>(
    `oms.table.${tableId}.density`,
    "comfortable",
  );
  // Enterprise Data Grid (TASK-060B Part 3) — column width/order/pinning/
  // filters persisted per user per table, same `oms.table.${tableId}.*`
  // localStorage convention as the pre-existing visibility/density state.
  const [columnWidths, setColumnWidths] = useLocalStorage<Record<string, number>>(
    `oms.table.${tableId}.columnWidths`,
    {},
  );
  const [columnPinning, setColumnPinning] = useLocalStorage<ColumnPinningState>(
    `oms.table.${tableId}.columnPinning`,
    {},
  );
  const [columnOrder, setColumnOrder] = useLocalStorage<ColumnOrderState>(
    `oms.table.${tableId}.columnOrder`,
    [],
  );
  const [columnFilters, setColumnFilters] = useLocalStorage<ColumnFiltersState>(
    `oms.table.${tableId}.columnFilters`,
    [],
  );
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const isServerMode = page !== undefined && onPageChange !== undefined;

  // Client-mode-only state — never read/written when a caller drives the
  // table in server mode, since that caller owns this state itself. Sort
  // and page size are persisted (page index isn't — the data set the index
  // points at can differ run to run, so restarting at page 1 is correct).
  const [internalPageIndex, setInternalPageIndex] = useState(0);
  const [internalPageSize, setInternalPageSize] = useLocalStorage<number>(
    `oms.table.${tableId}.pageSize`,
    pageSize,
  );
  const [internalSorting, setInternalSorting] = useLocalStorage<SortingState>(
    `oms.table.${tableId}.sorting`,
    [],
  );
  const [internalSearch, setInternalSearch] = useState("");
  const [internalRowSelection, setInternalRowSelection] = useState<RowSelectionState>({});

  // Column resize drag tracking — a custom pixel-width override layered on
  // top of the Smart Column Engine's percentage layout (see column-engine.ts)
  // rather than adopting TanStack's own `columnSizing` state, since that
  // engine already owns width computation for every column that hasn't been
  // manually resized. RTL-aware: dragging toward the reading start always
  // grows the column, regardless of which physical edge that is.
  const resizeState = useRef<{ columnId: string; startX: number; startWidth: number } | null>(null);
  const [resizingColumnId, setResizingColumnId] = useState<string | null>(null);

  const beginResize = useCallback(
    (columnId: string, event: React.PointerEvent, currentWidth: number) => {
      event.preventDefault();
      resizeState.current = { columnId, startX: event.clientX, startWidth: currentWidth };
      setResizingColumnId(columnId);

      const handleMove = (moveEvent: PointerEvent) => {
        const active = resizeState.current;
        if (!active) return;
        const rawDelta = moveEvent.clientX - active.startX;
        const delta = direction === "rtl" ? -rawDelta : rawDelta;
        const next = Math.min(
          MAX_COLUMN_WIDTH,
          Math.max(MIN_COLUMN_WIDTH, active.startWidth + delta),
        );
        setColumnWidths((previous) => ({ ...previous, [active.columnId]: next }));
      };
      const handleUp = () => {
        resizeState.current = null;
        setResizingColumnId(null);
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [direction, setColumnWidths],
  );

  const headerRefs = useRef<Record<string, HTMLTableCellElement | null>>({});

  const handleCopyCell = useCallback(
    (value: string) => {
      if (!value) return;
      navigator.clipboard?.writeText(value).then(
        () => toast.success(t("table.copied")),
        () => undefined,
      );
    },
    [t],
  );

  const resetColumnWidth = useCallback(
    (columnId: string) => {
      setColumnWidths((previous) => {
        if (!(columnId in previous)) return previous;
        const next = { ...previous };
        delete next[columnId];
        return next;
      });
    },
    [setColumnWidths],
  );

  const resetLayout = useCallback(() => {
    setColumnVisibility({});
    setDensity("comfortable");
    setColumnWidths({});
    setColumnPinning({});
    setColumnOrder([]);
    setColumnFilters([]);
    setInternalSorting([]);
    setInternalPageSize(pageSize);
    toast.success(t("table.layoutRestored"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectiveSearch = search ?? internalSearch;
  const handleSearchChange = onSearchChange ?? setInternalSearch;
  const effectiveRowSelection = rowSelection ?? internalRowSelection;
  const handleRowSelectionChange = onRowSelectionChange ?? setInternalRowSelection;

  const sorting: SortingState = useMemo(
    () =>
      isServerMode ? (sortBy ? [{ id: sortBy, desc: sortOrder === "desc" }] : []) : internalSorting,
    [isServerMode, sortBy, sortOrder, internalSorting],
  );

  const pagination = isServerMode
    ? { pageIndex: (page as number) - 1, pageSize }
    : { pageIndex: internalPageIndex, pageSize: internalPageSize };

  const selectionColumn = useMemo(
    () =>
      createSelectionColumn<TData>({
        selectAll: t("table.selectAll"),
        selectRow: t("table.selectRow"),
      }),
    [t],
  );

  // Injects the translated header (via the shared EnterpriseTableColumnHeader) from
  // each column's `meta.titleKey` — config files stay hook-free data, the
  // component is where `t()` is actually available.
  const renderedColumns = useMemo<ColumnDef<TData, unknown>[]>(
    () => [
      selectionColumn,
      ...columns.map(
        (column) =>
          ({
            ...column,
            header: ({
              column: col,
            }: {
              column: import("@tanstack/react-table").Column<TData, unknown>;
            }) => (
              <EnterpriseTableColumnHeader
                column={col}
                title={column.meta?.titleKey ? t(column.meta.titleKey) : (column.id ?? "")}
                align={resolveColumnLayout(col.id, col.columnDef.meta).align}
                canFilter={!isServerMode}
                canMultiSort={!isServerMode}
              />
            ),
          }) as ColumnDef<TData, unknown>,
      ),
    ],
    [columns, selectionColumn, t, isServerMode],
  );

  const resolveRowId = useCallback(
    (row: TData, index: number) =>
      getRowId ? getRowId(row, index) : ((row as { id?: string }).id ?? String(index)),
    [getRowId],
  );

  const table = useReactTable({
    data,
    columns: renderedColumns,
    state: {
      rowSelection: effectiveRowSelection,
      columnVisibility,
      columnPinning,
      columnOrder,
      // Column filters only ever act on data already in memory, so they
      // stay empty (and inert) in server mode rather than silently
      // filtering just the current page — see `canFilter` on the header.
      columnFilters: isServerMode ? [] : columnFilters,
      sorting,
      pagination,
      globalFilter: effectiveSearch,
    },
    getRowId: resolveRowId,
    manualPagination: isServerMode,
    manualSorting: isServerMode,
    manualFiltering: isServerMode,
    enableRowSelection: true,
    enableMultiSort: !isServerMode,
    enableColumnFilters: !isServerMode,
    ...(isServerMode ? { pageCount: Math.max(1, Math.ceil((totalCount ?? 0) / pageSize)) } : {}),
    onRowSelectionChange: (updater: Updater<RowSelectionState>) =>
      handleRowSelectionChange(
        typeof updater === "function" ? updater(effectiveRowSelection) : updater,
      ),
    onColumnVisibilityChange: setColumnVisibility,
    onColumnPinningChange: setColumnPinning,
    onColumnOrderChange: setColumnOrder,
    onColumnFiltersChange: (updater) =>
      setColumnFilters((previous) => (typeof updater === "function" ? updater(previous) : updater)),
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      if (isServerMode) {
        const first = next[0];
        if (first) onSortChange?.(first.id, first.desc ? "desc" : "asc");
      } else {
        setInternalSorting(next);
      }
    },
    onGlobalFilterChange: (value: string) => handleSearchChange(value),
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater(pagination) : updater;
      if (isServerMode) {
        if (next.pageSize !== pageSize) onPageSizeChange?.(next.pageSize);
        if (next.pageIndex !== (page as number) - 1) onPageChange?.(next.pageIndex + 1);
      } else {
        setInternalPageIndex(next.pageIndex);
        setInternalPageSize(next.pageSize);
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const selectedCount = Object.keys(effectiveRowSelection).length;
  // "Select all matching filters" (cross-page selection, Part 8) — only
  // offered in server mode, only once every row on the current page is
  // already selected, and only when the filtered set is actually bigger
  // than one page. `onSelectAllMatching` does the real work (fetch just the
  // matching IDs, never full records); this component only decides when to
  // show the affordance and renders its two states.
  const isCurrentPageFullySelected =
    isServerMode &&
    data.length > 0 &&
    data.every((row, index) => effectiveRowSelection[resolveRowId(row, index)]);
  const hasMoreThanPageMatching = isServerMode && (totalCount ?? 0) > data.length;
  const isAllMatchingSelected =
    isServerMode && (totalCount ?? 0) > 0 && selectedCount >= (totalCount ?? 0);
  // Comfortable: py-3.5 (28px) + text-body line-height (24px) = 52px row
  // height, landing in the spec's 52-56px band from existing tokens alone.
  // Compact stays a deliberately tighter alternate density.
  const cellPaddingClass = density === "compact" ? "py-2" : "py-3.5";
  const cellTextClass = density === "compact" ? "text-caption" : "text-body";

  // Smart Column Engine (TASK-035 FINAL) — resolve every currently-visible
  // leaf column's grow/preferredWidth/minWidth/maxWidth/importance/align
  // (declared or inferred), then turn that into `<colgroup>` percentage
  // width hints for the real `<table>` below. Recomputes only when the
  // visible column set actually changes.
  const visibleLeafColumns = table.getVisibleLeafColumns();
  const layoutById = useMemo(() => {
    const resolved = visibleLeafColumns.map((column) =>
      resolveColumnLayout(column.id, column.columnDef.meta),
    );
    return new Map(resolved.map((column) => [column.id, column]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleLeafColumns.map((c) => c.id).join(",")]);
  const resolvedColumns = useMemo(() => Array.from(layoutById.values()), [layoutById]);

  // Best-effort width used for a column when it hasn't been manually
  // resized — real percentage layout is fluid (recomputed on container
  // resize), so a pinned column's sticky offset can only ever approximate
  // that with a stable estimate (its own min-width/fixed-width) rather
  // than track the live rendered pixel value.
  const estimateColumnWidth = useCallback(
    (columnId: string) => {
      if (columnWidths[columnId]) return columnWidths[columnId];
      const layout = layoutById.get(columnId);
      return layout?.fixedWidth ?? layout?.minWidth ?? 120;
    },
    [columnWidths, layoutById],
  );

  const pinnedOffsets = useMemo(() => {
    const left = new Map<string, number>();
    const right = new Map<string, number>();
    let acc = 0;
    for (const column of visibleLeafColumns) {
      if (column.getIsPinned() !== "left") continue;
      left.set(column.id, acc);
      acc += estimateColumnWidth(column.id);
    }
    acc = 0;
    for (const column of [...visibleLeafColumns].reverse()) {
      if (column.getIsPinned() !== "right") continue;
      right.set(column.id, acc);
      acc += estimateColumnWidth(column.id);
    }
    return { left, right };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleLeafColumns.map((c) => `${c.id}:${c.getIsPinned()}`).join(","), estimateColumnWidth]);

  /** Sticky positioning for a pinned column — logical `insetInlineStart`/`End` so pinning behaves correctly in both LTR and RTL, matching the rest of the OMS design system's logical-properties rule. */
  const getPinStyle = useCallback(
    (columnId: string): React.CSSProperties | undefined => {
      const column = table.getColumn(columnId);
      const pinned = column?.getIsPinned();
      if (!pinned) return undefined;
      const offset =
        (pinned === "left"
          ? pinnedOffsets.left.get(columnId)
          : pinnedOffsets.right.get(columnId)) ?? 0;
      return {
        position: "sticky",
        [pinned === "left" ? "insetInlineStart" : "insetInlineEnd"]: offset,
        zIndex: pinned ? 6 : undefined,
        backgroundColor: "var(--card)",
      };
    },
    [table, pinnedOffsets],
  );

  // Print only real business columns — never the actions/checkbox column,
  // and never a column the user has hidden on screen — through the shared
  // Enterprise Print Engine (never `window.print()` on this page itself).
  // Client mode prints every row matching the current search, not just the
  // on-screen page, since there's no "next page" for a printed report.
  const handlePrint = () => {
    const printableColumns = columns.filter(
      (column) => column.id && column.id !== "__actions" && columnVisibility[column.id] !== false,
    );
    const rowsToPrint = isServerMode
      ? data
      : table.getFilteredRowModel().rows.map((row) => row.original);
    printList({
      variant: "list",
      title: printTitle ?? tableId,
      company: {
        name: activeCompany?.name ?? siteConfig.fullName,
        logoUrl: activeCompany?.logoUrl ?? null,
      },
      printedByName: user?.fullName ?? null,
      columns: printableColumns.map((column) => ({
        key: column.id!,
        label: column.meta?.titleKey ? t(column.meta.titleKey) : (column.id ?? ""),
      })),
      rows: rowsToPrint.map((row) =>
        Object.fromEntries(
          printableColumns.map((column) => [column.id!, getColumnDisplayValue(column, row)]),
        ),
      ),
    });
  };

  return (
    <div className="flex flex-col gap-3" id={`table-${tableId}`}>
      {selectedCount > 0 && bulkActions && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-border bg-muted/40 px-3 py-2">
          <span className="text-caption font-medium">
            {isAllMatchingSelected
              ? t("table.allMatchingSelected", { count: selectedCount })
              : `${selectedCount} ${t("table.rowsSelected")}`}
          </span>

          {/* "Select all matching filters" — offered once every row on this
              page is checked; disappears once the whole filtered set is
              already selected, replaced by a plain clear-selection action. */}
          {onSelectAllMatching &&
            isCurrentPageFullySelected &&
            hasMoreThanPageMatching &&
            !isAllMatchingSelected && (
              <EnterpriseButton
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                disabled={isSelectingAllMatching}
                onClick={() => onSelectAllMatching()}
              >
                {isSelectingAllMatching
                  ? t("table.selectingAllMatching")
                  : t("table.selectAllMatching", { count: totalCount ?? 0 })}
              </EnterpriseButton>
            )}

          <EnterpriseButton
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-muted-foreground"
            onClick={() => handleRowSelectionChange({})}
          >
            {t("table.clearSelection")}
          </EnterpriseButton>

          <div className="ms-auto flex items-center gap-2">{bulkActions}</div>
        </div>
      )}

      {/* Premium Table Card (TASK-036 V2) — toolbar, grid, and pagination
          live inside one contiguous card so the table never feels like a
          bare HTML element floating on the page. `@container/enterprise-table`
          drives the responsive column-hide engine off the card's own
          available width, not the viewport, since a fixed-width sidebar
          means those two diverge. */}
      <div className="@container/enterprise-table flex flex-col overflow-hidden rounded-md border border-border/70 bg-card shadow-xs">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-6 py-3">
          <Input
            value={effectiveSearch}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder={t("table.filterPlaceholder")}
            className="h-(--control-height-sm) max-w-(--width-control-search)"
          />
          <div className="ms-auto flex items-center gap-2">
            {onRefresh && (
              <EnterpriseButton
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={onRefresh}
              >
                <RefreshCw className="size-3.5" />
                {t("table.refresh")}
              </EnterpriseButton>
            )}
            <EnterpriseButton
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handlePrint}
            >
              <Printer className="size-3.5" />
              {t("table.print")}
            </EnterpriseButton>
            {onImport && (
              <EnterpriseButton
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setImportDialogOpen(true)}
              >
                <Upload className="size-3.5" />
                {t("common.import")}
              </EnterpriseButton>
            )}
            {exportColumns && exportColumns.length > 0 && onExport && (
              <EnterpriseButton
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setExportDialogOpen(true)}
              >
                <Download className="size-3.5" />
                {t("table.export")}
              </EnterpriseButton>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <EnterpriseButton type="button" variant="outline" size="sm" className="gap-1.5">
                  <Rows3 className="size-3.5" />
                  {t("table.density")}
                </EnterpriseButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setDensity("comfortable")}>
                  {t("table.densityComfortable")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDensity("compact")}>
                  {t("table.densityCompact")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <EnterpriseTableViewOptions table={table} />
            <Tooltip>
              <TooltipTrigger asChild>
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("table.restoreDefaultLayout")}
                  onClick={resetLayout}
                >
                  <RotateCcw className="size-3.5" />
                </EnterpriseButton>
              </TooltipTrigger>
              <TooltipContent side="top">{t("table.restoreDefaultLayout")}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Smart Column Engine (TASK-036 V2) — a real `<table>`, never CSS
            Grid. `<colgroup>` gives flexible columns a percentage width
            proportional to their `grow` share; fixed/utility columns get
            no hint at all and size to their own content. `overflow-x-auto`
            is the LAST resort: the responsive hide classes below already
            drop low/medium columns against the card's own container width
            before scrolling ever has to kick in. */}
        <div className="max-h-[70vh] overflow-auto">
          <Table className="w-full table-auto border-separate border-spacing-0">
            <colgroup>
              {visibleLeafColumns.map((column) => {
                const manualWidth = columnWidths[column.id];
                if (manualWidth)
                  return <col key={column.id} style={{ width: `${manualWidth}px` }} />;
                const layout = layoutById.get(column.id);
                const percent = layout ? columnWidthPercent(layout, resolvedColumns) : undefined;
                return (
                  <col key={column.id} style={percent ? { width: `${percent}%` } : undefined} />
                );
              })}
            </colgroup>
            <TableHeader className="sticky top-0 z-10 bg-muted/50 shadow-[0_1px_0_0_var(--border)]">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {headerGroup.headers.map((header, index) => {
                    const layout = layoutById.get(header.id);
                    const isResizable = layout?.type !== "checkbox" && layout?.type !== "actions";
                    return (
                      <TableHead
                        key={header.id}
                        ref={(el) => {
                          headerRefs.current[header.id] = el;
                        }}
                        className={cn(
                          "relative px-4 py-3 text-caption font-semibold tracking-wide text-muted-foreground",
                          index === 0 && "ps-6",
                          index === headerGroup.headers.length - 1 && "pe-6",
                          alignClass[layout?.align ?? "start"],
                          responsiveHideClass(layout?.importance ?? "high"),
                        )}
                        style={{
                          minWidth: layout?.minWidth ?? undefined,
                          maxWidth: columnWidths[header.id]
                            ? undefined
                            : (layout?.maxWidth ?? undefined),
                          ...getPinStyle(header.id),
                        }}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        {isResizable && (
                          <div
                            role="separator"
                            aria-label={t("table.resizeColumn")}
                            onPointerDown={(event) =>
                              beginResize(
                                header.id,
                                event,
                                headerRefs.current[header.id]?.getBoundingClientRect().width ??
                                  estimateColumnWidth(header.id),
                              )
                            }
                            onDoubleClick={() => resetColumnWidth(header.id)}
                            className={cn(
                              // Straddles the column boundary (2px visible, 8px hit area via negative
                              // end-margin) — a bare 1-2px line is nearly unhittable with a real mouse.
                              "absolute inset-y-0 end-0 z-[1] -me-1 w-2 cursor-col-resize touch-none select-none before:absolute before:inset-y-0 before:start-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent hover:before:bg-primary/50",
                              resizingColumnId === header.id && "before:bg-primary",
                            )}
                          />
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {visibleLeafColumns.map((column, index) => {
                      const layout = layoutById.get(column.id);
                      return (
                        <TableCell
                          key={column.id}
                          className={cn(
                            "align-middle",
                            index === 0 ? "ps-6" : "px-4",
                            index === visibleLeafColumns.length - 1 && "pe-6",
                            cellPaddingClass,
                            responsiveHideClass(layout?.importance ?? "high"),
                          )}
                        >
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              ) : table.getRowModel().rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={visibleLeafColumns.length} className="h-auto p-0">
                    <EmptyState icon={Inbox} title={emptyTitle ?? t("table.noResults")} />
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    className="transition-colors duration-150 hover:bg-muted/40 data-[state=selected]:bg-primary/5"
                  >
                    {row.getVisibleCells().map((cell, index) => {
                      const layout = layoutById.get(cell.column.id);
                      const isUtility = layout?.type === "checkbox" || layout?.type === "actions";
                      const content = flexRender(cell.column.columnDef.cell, cell.getContext());
                      const displayValue = isUtility
                        ? ""
                        : getColumnDisplayValue(cell.column.columnDef, row.original);
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            "align-middle",
                            index === 0 ? "ps-6" : "px-4",
                            index === row.getVisibleCells().length - 1 && "pe-6",
                            cellPaddingClass,
                            cellTextClass,
                            alignClass[layout?.align ?? "start"],
                            responsiveHideClass(layout?.importance ?? "high"),
                          )}
                          style={{
                            minWidth: layout?.minWidth ?? undefined,
                            maxWidth: columnWidths[cell.column.id]
                              ? undefined
                              : (layout?.maxWidth ?? undefined),
                            ...getPinStyle(cell.column.id),
                          }}
                        >
                          {isUtility ? (
                            content
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div
                                  className="block truncate"
                                  onDoubleClick={() => handleCopyCell(displayValue)}
                                  title=""
                                >
                                  {content}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top">{displayValue}</TooltipContent>
                            </Tooltip>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="border-t border-border/70 px-6 py-3">
          <EnterprisePagination table={table} />
        </div>
      </div>

      {exportColumns && onExport && (
        <ExportDialog
          open={exportDialogOpen}
          onOpenChange={setExportDialogOpen}
          columns={exportColumns}
          onExport={onExport}
        />
      )}

      {onImport && (
        <ImportDialog
          open={importDialogOpen}
          onOpenChange={setImportDialogOpen}
          onImport={onImport}
        />
      )}
    </div>
  );
}

/** Foundation CSV export — client-side only, current page's data. */
export function exportRowsToCsv<TData extends Record<string, unknown>>(
  rows: TData[],
  columnKeys: string[],
  filename: string,
) {
  const header = columnKeys.join(",");
  const body = rows
    .map((row) =>
      columnKeys
        .map((key) => {
          const value = row[key];
          const text = value === null || value === undefined ? "" : String(value);
          return `"${text.replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\n");
  // Leading UTF-8 BOM is required for Excel — without it, Excel ignores the
  // "charset=utf-8" MIME hint on a downloaded file and guesses the system
  // codepage instead, garbling Arabic and other non-ASCII text.
  const BOM = "﻿";
  const blob = new Blob([`${BOM}${header}\n${body}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
