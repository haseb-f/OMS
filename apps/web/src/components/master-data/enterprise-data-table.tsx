"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Download,
  Filter,
  Inbox,
  Printer,
  RefreshCw,
  RotateCcw,
  Upload,
} from "lucide-react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnOrderState,
  type ColumnPinningState,
  type ExpandedState,
  type RowSelectionState,
  type SortingState,
  type Updater,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  tableAlignClass,
  tableColumnInsetClass,
  tableCellContentClass,
  tableCellWrapClass,
  tableIdentityCellClass,
  type TableDensity as UiTableDensity,
} from "@/components/ui/table";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseBadge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchInput } from "@/components/shared/search-input";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import {
  ListFooter,
  ListSurface,
  ListToolbar,
  useViewportFill,
} from "@/components/shared/data-table/list-surface";
import { OverflowTooltipRegion } from "@/components/shared/data-table/overflow-tooltip";
import {
  FilterBarProvider,
  type FilterBarState,
} from "@/components/shared/data-table/filter-bar-context";
import { normalizeTablePageSize } from "@/components/shared/data-table/data-table-pagination";
import {
  isNumericColumnType,
  isTabularColumnType,
} from "@/components/shared/data-table/column-engine";
import { ExportDialog, type ExportColumn } from "@/components/shared/export-dialog";
import { ImportDialog } from "@/components/shared/import-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  EnterpriseTableColumnHeader,
  EnterprisePagination,
  EnterpriseTableViewOptions,
  createSelectionColumn,
  getTableSelectionScope,
  SelectionScopeSummary,
  selectionQuerySignature,
  createMatchingSelectionSnapshot,
  toRowSelection,
  useSelectedRecords,
  type MatchingSelectionSnapshot,
  getColumnDisplayValue,
  resolveColumnLayout,
  columnGeometryWidth,
  columnSetMinWidth,
  planColumnWidths,
  responsiveHideClass,
  layoutDetailRegions,
  hasTableDetailContent,
  RowActionsMenu,
  RowIdentityLink,
  SelectCustomCountDialog,
  type RowAction,
  type ColumnImportance,
  type ColumnType,
  type TableDetailRegion,
  type SelectCustomCountCopy,
} from "@/components/shared/data-table";
import { applySemanticCellContent } from "@/components/shared/data-table/semantic-cell";
import { useColumnWidthPreference } from "@/components/shared/data-table/column-width-preferences";
import {
  useTableDensityPreference,
  useTableViewPreference,
} from "@/components/shared/data-table/table-preferences";
import { EnterpriseTableDensityControl } from "@/components/shared/data-table/data-table-density-control";
import { EnterpriseTableViewToggle } from "@/components/shared/data-table/data-table-view-toggle";
import { EnterpriseTableSortMenu } from "@/components/shared/data-table/data-table-sort-menu";
import { toPrintColumn } from "@/components/shared/data-table/print-columns";
import { useCopyToClipboard } from "@/components/shared/use-copy-to-clipboard";
import { COPY_REVEAL_CLASS, CopyButton } from "@/components/shared/copy-button";
import { useLocale } from "@/providers/locale-provider";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useRestorableState } from "@/hooks/use-restorable-state";
import { SEARCH_DEBOUNCE_MS } from "@/hooks/use-debounced-value";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { usePrintCompany } from "@/components/print/print-brand";
import { useUserContext } from "@/providers/user-context";
import { bidiLineClass, isStackedCellNode } from "@/components/shared/stacked-cell";
import { cn } from "@/lib/utils";
import { useElementWidth } from "@/hooks/use-element-width";
import { reportApiError, toast } from "@/lib/toast";
import type { GenericListPrintPayload } from "@/types/print-engine";
import type { MessageKey } from "@/i18n/translate";

/** Sane resize bounds when a column has no declared min/max in the Smart Column Engine. */
const MIN_COLUMN_WIDTH = 60;
/** Identity content wider than this truncates (with the overflow tooltip). */
const IDENTITY_FLOOR_CAP = 320;

/**
 * Natural width a header cell needs: inline padding + the full translated
 * label + its sort icon + the column-menu controls, so none of them clip.
 */
function measureHeaderNeed(th: HTMLElement): number {
  const style = getComputedStyle(th);
  const padding =
    (Number.parseFloat(style.paddingInlineStart) || 0) +
    (Number.parseFloat(style.paddingInlineEnd) || 0);
  const group = th.querySelector<HTMLElement>('[class~="group/header"]');
  if (!group) {
    const range = document.createRange();
    range.selectNodeContents(th);
    return Math.ceil(padding + range.getBoundingClientRect().width + 2);
  }
  const [labelEl, controls] = Array.from(group.children) as HTMLElement[];
  const title = labelEl?.querySelector<HTMLElement>(".truncate") ?? null;
  const label = labelEl
    ? labelEl.offsetWidth - (title?.clientWidth ?? 0) + (title?.scrollWidth ?? 0)
    : 0;
  const gap = Number.parseFloat(getComputedStyle(group).columnGap) || 0;
  const controlsWidth = controls ? controls.offsetWidth + gap : 0;
  return Math.ceil(padding + label + controlsWidth + 2);
}

/** Natural width of an identity cell's content (widest truncated descendant). */
function measureCellNeed(td: HTMLElement): number {
  const style = getComputedStyle(td);
  const padding =
    (Number.parseFloat(style.paddingInlineStart) || 0) +
    (Number.parseFloat(style.paddingInlineEnd) || 0);
  let content = 0;
  td.querySelectorAll<HTMLElement>("*").forEach((element) => {
    content = Math.max(content, element.scrollWidth);
  });
  return Math.ceil(padding + content + 4);
}

/**
 * Auto-fit (double-click a resize handle): the width a body cell's content
 * needs on one line, independent of the column's current width — the
 * content box is measured at `max-content` and restored in the same frame.
 */
function measureCellIntrinsicWidth(td: HTMLElement): number {
  const child = td.firstElementChild as HTMLElement | null;
  if (!child) return 0;
  const style = getComputedStyle(td);
  const padding =
    (Number.parseFloat(style.paddingInlineStart) || 0) +
    (Number.parseFloat(style.paddingInlineEnd) || 0);
  const { width, maxWidth } = child.style;
  child.style.width = "max-content";
  child.style.maxWidth = "none";
  const content = child.getBoundingClientRect().width;
  child.style.width = width;
  child.style.maxWidth = maxWidth;
  return Math.ceil(padding + content + 4);
}

const MAX_COLUMN_WIDTH = 640;

/**
 * Column types whose values people paste elsewhere (R6 B2): a phone into a
 * dialer/chat, a reference into a search or a message. Their cells carry the
 * shared inline copy button, whatever renders the cell.
 */
const COPYABLE_COLUMN_TYPES: ReadonlySet<ColumnType> = new Set(["phone", "reference"]);

/** The text a cell's copy button copies, or null when the cell has none. */
export function cellCopyText(type: ColumnType | undefined, displayValue: string): string | null {
  if (!type || !COPYABLE_COLUMN_TYPES.has(type)) return null;
  const text = displayValue.trim();
  return text && text !== "—" ? text : null;
}

/** Keyboard resize step (px); Shift moves four steps. */
const RESIZE_KEY_STEP = 16;

/** Clamps a requested column width to the resize bounds. */
export function clampColumnWidth(width: number, minWidth: number): number {
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(minWidth, width)));
}

export type SortOrder = "asc" | "desc";
export type TableDensity = UiTableDensity;

export type MobileRowRenderArgs<TData> = {
  row: TData;
  selected: boolean;
  onToggleSelected: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
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
  searchPlaceholder,
  isLoading,
  rowSelection,
  onRowSelectionChange,
  bulkActions,
  onSelectAllMatching,
  isSelectingAllMatching,
  selectCustomCount,
  exportColumns,
  onExport,
  onImport,
  onRefresh,
  tableId,
  printTitle,
  fetchAllRows,
  emptyTitle,
  getRowId,
  error,
  onRetry,
  getRowCanExpand,
  renderExpandedRegions,
  filterBar,
  renderMobileRow,
  renderGridCard,
  getRowHref,
  identityOnlyNavigation,
  footerRow,
  activeFilterCount,
  onClearFilters,
  selectionResetKey,
  matchingSelection,
  builtInSelectionActions = true,
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
  /** Overrides the generic "Filter..." placeholder — use this when the search box covers specific fields worth naming (e.g. "Search by order number, customer name, or phone..."). */
  searchPlaceholder?: string;
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
  /**
   * "Select a specific number" (TASK-064, opt-in) — omit to hide that menu
   * item entirely. `onSelect` fetches/selects the first `count` rows by the
   * caller's current filter+sort (the same job `onSelectAllMatching` does,
   * unbounded); every string in `copy` is caller-owned since "N orders"
   * needs the caller's own noun and grammar.
   */
  selectCustomCount?: {
    onSelect: (count: number) => void | Promise<void>;
    isSelecting?: boolean;
    copy: SelectCustomCountCopy;
  };
  /** Columns offered in the Export dialog's picker — omit to hide the Export button entirely. */
  exportColumns?: ExportColumn[];
  /** Foundation only — exports the current page's visible rows for the columns the user kept checked. */
  onExport?: (selectedKeys: string[], selectedColumns: ExportColumn[]) => void;
  /** Opt-in — no Master Data entity has a real bulk-import endpoint yet, so this only renders an Import button when a caller supplies one. */
  onImport?: (rows: Record<string, string>[]) => Promise<void> | void;
  /** Manual reload — omit to hide the Refresh button. */
  onRefresh?: () => void;
  tableId: string;
  /** Title the Print Engine's document header shows — e.g. "Products List". Falls back to `tableId` when omitted. */
  printTitle?: string;
  /**
   * Server mode only — loads EVERY row matching the current search/filters/
   * sort (bounded; see `lib/fetch-all-pages.ts`) so Print outputs the whole
   * dataset, not just the loaded page. `total` is the full match count; when
   * it exceeds `rows.length` the sheet states "N / M rows". Omit and Print
   * falls back to the loaded page, still stating the true total.
   */
  fetchAllRows?: () => Promise<{ rows: TData[]; total: number; notes?: string[] }>;
  /** Overrides the empty-state message — falls back to the generic "No results." copy. */
  emptyTitle?: string;
  /** Row identity for stable selection across sorts/pagination. Defaults to `row.id` when present, otherwise the row's index — pass this for rows with no natural single-field id (e.g. a report keyed by product+warehouse). */
  getRowId?: (row: TData, index: number) => string;
  /** List-load failure — shown instead of an empty table, with Retry when `onRetry` is passed. */
  error?: string | null;
  onRetry?: () => void;
  getRowCanExpand?: (row: TData) => boolean;
  /** Semantic regions mapped onto the master column ids — never an independent grid. */
  renderExpandedRegions?: (row: TData) => TableDetailRegion[];
  /** Filter controls rendered with search as the table card's first strip. */
  filterBar?: ReactNode;
  /** Narrow-container list; table remains the desktop workspace. */
  renderMobileRow?: (args: MobileRowRenderArgs<TData>) => ReactNode;
  /**
   * Opt-in Grid view (R7). When provided, the toolbar offers a Table/Grid
   * switch (remembered per user, per table) and Grid forces the same card
   * branch the narrow container uses — whatever the width — drawing each row
   * with this renderer. Records, filters, sort, pagination and selection are
   * the table's own, so switching views changes the presentation only.
   */
  renderGridCard?: (args: MobileRowRenderArgs<TData>) => ReactNode;
  /**
   * Detail route for a row. Opt-in: tables for entities with no detail route
   * simply omit it. When present, the whole row navigates on click — the
   * column marked `meta.identity` additionally renders as a real `<a>`, so
   * middle-click, Ctrl+click and "copy link" work from that cell exactly like
   * navigation is expected to. Interactive children (checkbox, expand
   * chevron, actions menu, inline controls) own their own click and never
   * trigger row navigation.
   */
  getRowHref?: (row: TData) => string | null | undefined;
  /**
   * When the row itself has enough clickable inline controls (quick-edit
   * selects, attachments, tracking) that "click anywhere navigates" turns
   * every blank cell into an accidental navigation trap — Shipping, not
   * ordinary Master Data lists — set this to make the row inert and rely
   * entirely on `meta.identity` columns (see `getRowHref`'s own doc) for
   * navigation. Every other table keeps the default "whole row navigates,
   * interactive children opt out" behavior.
   */
  identityOnlyNavigation?: boolean;
  /**
   * Column-aligned totals row, keyed by column id — rendered in a sticky
   * `<tfoot>` with the body's exact inset/alignment. Merged over any
   * per-column `meta.footer`. Omit both to render no totals row.
   */
  footerRow?: Partial<Record<string, ReactNode>>;
  /**
   * Engaged-filter count for the collapsed "Filters" button (narrow
   * containers). Optional: a `ClearFiltersButton` inside `filterBar`
   * reports it automatically.
   */
  activeFilterCount?: number;
  /** Resets every filter in `filterBar` — the filter sheet's Clear action. Same automatic fallback as `activeFilterCount`. */
  onClearFilters?: () => void;
  /**
   * The caller's filters (anything outside the table that changes WHICH
   * records match) as a plain serializable value. When the query changes, any
   * row selection is cleared and the user is told (tables-selection.md): a
   * selection always belongs to the query it was made under. The table's own
   * search box, column filters and sort are included automatically;
   * pagination and page size never clear.
   */
  selectionResetKey?: unknown;
  /**
   * Server mode: the last complete "select all matching" result for the
   * current query (`useMatchingSelection().matchingSelection`). "All N
   * matching results selected" is shown only while the selection equals it —
   * never inferred from the selected count reaching `totalCount`.
   */
  matchingSelection?: MatchingSelectionSnapshot | null;
  /**
   * Built-in selection tools (default on): when rows are selected the bulk
   * strip offers "Print selected" (and "Export selected" when the table has
   * an export), always for exactly the selected records across pages; and
   * the header menu offers "Select all matching" / "Select a specific
   * number" when the caller wires none of its own — from the in-memory rows
   * (client mode) or the bounded `fetchAllRows` (server mode). Pass `false`
   * only on a page whose own `bulkActions` already print/export the
   * selection.
   */
  builtInSelectionActions?: boolean;
}) {
  const { t, direction, locale } = useLocale();
  const router = useRouter();
  const viewportFill = useViewportFill();
  const { printList, runPrint } = usePrintEngine();
  const printCompany = usePrintCompany();
  const { user } = useUserContext();
  const [columnVisibility, setColumnVisibility] = useLocalStorage<VisibilityState>(
    `oms.table.${tableId}.columnVisibility`,
    {},
  );
  // Density and the Table/Grid view are per-USER, per-table preferences (R7 A).
  const [density, setDensity] = useTableDensityPreference(tableId, user?.id);
  const [view, setView] = useTableViewPreference(tableId, user?.id);
  const isGrid = Boolean(renderGridCard) && view === "grid";
  // Enterprise Data Grid (TASK-060B Part 3) — column width/order/pinning/
  // filters persisted per user per table, same `oms.table.${tableId}.*`
  // localStorage convention as the pre-existing visibility/density state.
  // Widths are a per-USER preference (R6 B4): `oms.table.<userId>.<tableId>.
  // columnWidths`, adopting the old device-wide key once.
  const [columnWidths, setColumnWidths] = useColumnWidthPreference(tableId, user?.id);
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
  const [expanded, setExpanded] = useRestorableState<ExpandedState>(
    `oms.table.${tableId}.session.expanded`,
    {},
  );
  const canExpandRows = Boolean(renderExpandedRegions);

  const isServerMode = page !== undefined && onPageChange !== undefined;

  // Client-mode-only state — never read/written when a caller drives the
  // table in server mode, since that caller owns this state itself. Sort
  // and page size are persisted in localStorage; search, page index, and
  // expanded rows use the in-memory session cache so list → detail → Back
  // restores them without surviving a full reload.
  const [internalPageIndex, setInternalPageIndex] = useRestorableState(
    `oms.table.${tableId}.session.pageIndex`,
    0,
  );
  const [internalPageSize, setInternalPageSize] = useLocalStorage<number>(
    `oms.table.${tableId}.pageSize`,
    pageSize,
  );
  const [internalSorting, setInternalSorting] = useLocalStorage<SortingState>(
    `oms.table.${tableId}.sorting`,
    [],
  );
  const [internalSearch, setInternalSearch] = useRestorableState(
    `oms.table.${tableId}.session.search`,
    "",
  );
  const [internalRowSelection, setInternalRowSelection] = useState<RowSelectionState>({});

  // Column resize drag tracking — a custom pixel-width override layered on
  // top of the Smart Column Engine's percentage layout (see column-engine.ts)
  // rather than adopting TanStack's own `columnSizing` state, since that
  // engine already owns width computation for every column that hasn't been
  // manually resized. RTL-aware: dragging toward the reading start always
  // grows the column, regardless of which physical edge that is.
  const resizeState = useRef<{
    columnId: string;
    startX: number;
    startWidth: number;
    minWidth: number;
  } | null>(null);
  const [resizingColumnId, setResizingColumnId] = useState<string | null>(null);

  const beginResize = useCallback(
    (columnId: string, event: React.PointerEvent, currentWidth: number, minWidth: number) => {
      // A resize never sorts, selects or starts a text selection.
      event.preventDefault();
      event.stopPropagation();
      resizeState.current = {
        columnId,
        startX: event.clientX,
        startWidth: currentWidth,
        minWidth,
      };
      setResizingColumnId(columnId);

      const handleMove = (moveEvent: PointerEvent) => {
        const active = resizeState.current;
        if (!active) return;
        const rawDelta = moveEvent.clientX - active.startX;
        const delta = direction === "rtl" ? -rawDelta : rawDelta;
        const next = clampColumnWidth(active.startWidth + delta, active.minWidth);
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

  // Double-click a value to copy it: the shared copy hook (R6 B2) — the toast
  // confirms because a cell has no button to show the check; a blocked
  // clipboard explains itself instead of failing silently.
  const { copy: copyCellValue } = useCopyToClipboard({ successToast: t("table.copied") });
  const handleCopyCell = useCallback(
    (value: string) => {
      if (value) void copyCellValue(value);
    },
    [copyCellValue],
  );

  /** Double-click a resize handle: fit the column to its header and the rendered values. */
  const autoFitColumn = useCallback(
    (columnId: string, minWidth: number) => {
      const th = headerRefs.current[columnId];
      const tableElement = th?.closest("table");
      if (!th || !tableElement) return;
      let need = measureHeaderNeed(th);
      tableElement
        .querySelectorAll<HTMLElement>(`tbody td[data-column-id="${CSS.escape(columnId)}"]`)
        .forEach((td) => {
          if (td.offsetWidth > 0 && !td.hasAttribute("colspan")) {
            need = Math.max(need, measureCellIntrinsicWidth(td));
          }
        });
      const width = clampColumnWidth(need, minWidth);
      setColumnWidths((previous) => ({ ...previous, [columnId]: width }));
    },
    [setColumnWidths],
  );

  /** Arrow keys on a focused handle (RTL-aware: the arrow toward the column's end edge grows it); Enter auto-fits. */
  const handleResizeKey = useCallback(
    (columnId: string, event: React.KeyboardEvent, currentWidth: number, minWidth: number) => {
      if (event.key === "Enter") {
        event.preventDefault();
        autoFitColumn(columnId, minWidth);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      const towardEnd = (event.key === "ArrowRight") === (direction === "ltr");
      const step = RESIZE_KEY_STEP * (event.shiftKey ? 4 : 1);
      const width = clampColumnWidth(currentWidth + (towardEnd ? step : -step), minWidth);
      setColumnWidths((previous) => ({ ...previous, [columnId]: width }));
    },
    [autoFitColumn, direction, setColumnWidths],
  );

  const hasCustomColumnWidths = Object.keys(columnWidths).length > 0;
  const resetColumnWidths = useCallback(() => {
    setColumnWidths({});
    toast.success(t("controls.table.columnWidthsReset"));
  }, [setColumnWidths, t]);

  const resetLayout = useCallback(() => {
    setColumnVisibility({});
    setDensity("compact");
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

  // Debounce the committed search value (not the input's own displayed
  // text) so a server-mode table doesn't fire one request per keystroke —
  // client-mode tables filter in-memory off the same debounced value too,
  // which costs nothing noticeable and keeps one code path for both modes.
  // `pendingSearchRef` distinguishes "we just committed this ourselves" from
  // an external reset (session restore, a bulk-selection query change, the
  // empty-state's Clear action) so that kind of change resyncs the draft
  // immediately instead of being mistaken for stale debounce state.
  const [searchDraft, setSearchDraft] = useState(effectiveSearch);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSearchRef = useRef(effectiveSearch);

  useEffect(() => {
    if (effectiveSearch === pendingSearchRef.current) return;
    pendingSearchRef.current = effectiveSearch;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    setSearchDraft(effectiveSearch);
  }, [effectiveSearch]);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  const commitSearch = useCallback(
    (value: string) => {
      pendingSearchRef.current = value;
      handleSearchChange(value);
    },
    [handleSearchChange],
  );

  const handleSearchInput = (value: string) => {
    setSearchDraft(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => commitSearch(value), SEARCH_DEBOUNCE_MS);
  };

  const handleSearchClear = () => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    setSearchDraft("");
    commitSearch("");
  };

  /**
   * An empty result while a search term is active means "no match", not
   * "nothing here" — names the term and offers one click back to the full
   * filtered list, instead of the generic "No results." every other empty
   * table shows.
   */
  const emptyStateProps = effectiveSearch.trim()
    ? {
        title: t("table.noSearchResults", { term: effectiveSearch.trim() }),
        description: t("table.noSearchResultsHint"),
        action: (
          <EnterpriseButton type="button" variant="outline" size="sm" onClick={handleSearchClear}>
            {t("table.clearSearch")}
          </EnterpriseButton>
        ),
      }
    : { title: emptyTitle ?? t("table.noResults") };
  const effectiveRowSelection = rowSelection ?? internalRowSelection;
  const handleRowSelectionChange = onRowSelectionChange ?? setInternalRowSelection;

  // Filter/search/sort change → clear the selection (all scopes). A kept
  // selection would either describe records the user can no longer see or
  // silently stop meaning "all matching" — clearing is the only safe reading.
  const selectionQueryKey = selectionQuerySignature({
    caller: selectionResetKey,
    search: effectiveSearch,
    columnFilters,
    sorting: isServerMode ? { sortBy, sortOrder } : internalSorting,
  });
  const lastSelectionQueryKey = useRef(selectionQueryKey);
  useEffect(() => {
    if (lastSelectionQueryKey.current === selectionQueryKey) return;
    lastSelectionQueryKey.current = selectionQueryKey;
    if (!Object.values(effectiveRowSelection).some(Boolean)) return;
    handleRowSelectionChange({});
    toast.info(t("table.selectionClearedOnQueryChange"));
    // Only a query change may clear — never a selection change itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionQueryKey]);

  const sorting: SortingState = useMemo(
    () =>
      isServerMode ? (sortBy ? [{ id: sortBy, desc: sortOrder === "desc" }] : []) : internalSorting,
    [isServerMode, sortBy, sortOrder, internalSorting],
  );

  // A size persisted before the 20/50/100 set (10, 30) maps onto it.
  const pagination = isServerMode
    ? { pageIndex: (page as number) - 1, pageSize }
    : { pageIndex: internalPageIndex, pageSize: normalizeTablePageSize(internalPageSize) };

  const [customCountDialogOpen, setCustomCountDialogOpen] = useState(false);

  // Built-in "select all matching" / "first N" (see `builtInSelectionActions`):
  // only where the caller wires none of its own, and only where every
  // matching row can actually be listed — in memory, or via `fetchAllRows`.
  const canBuiltInScope = builtInSelectionActions && (!isServerMode || Boolean(fetchAllRows));
  const builtInSelectAll = !onSelectAllMatching && canBuiltInScope;
  const builtInCustomCount = !selectCustomCount && canBuiltInScope;
  const [builtInSnapshot, setBuiltInSnapshot] = useState<MatchingSelectionSnapshot | null>(null);
  const [isBuiltInSelecting, setIsBuiltInSelecting] = useState(false);
  const builtInScopeRef = useRef<{
    selectAll: () => Promise<void>;
    selectFirst: (count: number) => Promise<void>;
  } | null>(null);
  const effectiveMatchingSelection =
    matchingSelection ?? (builtInSnapshot?.query === selectionQueryKey ? builtInSnapshot : null);

  const selectionColumn = useMemo(
    () =>
      createSelectionColumn<TData>(
        { selectAll: t("table.selectAll"), selectRow: t("table.selectRow") },
        {
          onSelectAllMatching:
            onSelectAllMatching ??
            (builtInSelectAll ? () => builtInScopeRef.current?.selectAll() : undefined),
          isSelectingAllMatching: isSelectingAllMatching || isBuiltInSelecting,
          onRequestCustomCount:
            selectCustomCount || builtInCustomCount
              ? () => setCustomCountDialogOpen(true)
              : undefined,
          onClearSelection: () => handleRowSelectionChange({}),
          matchingSelection: effectiveMatchingSelection,
        },
      ),
    [
      t,
      onSelectAllMatching,
      builtInSelectAll,
      isSelectingAllMatching,
      isBuiltInSelecting,
      selectCustomCount,
      builtInCustomCount,
      handleRowSelectionChange,
      effectiveMatchingSelection,
    ],
  );

  // Injects the translated header (via the shared EnterpriseTableColumnHeader) from
  // each column's `meta.titleKey` — config files stay hook-free data, the
  // component is where `t()` is actually available.
  const expandColumn = useMemo<ColumnDef<TData, unknown> | null>(() => {
    if (!canExpandRows) return null;
    return {
      id: "__expand",
      enableHiding: false,
      enableSorting: false,
      meta: { align: "center" },
      header: () => <span className="sr-only">{t("common.expand")}</span>,
      cell: ({ row }) => {
        const expanded = row.getIsExpanded();
        const label = expanded ? t("common.collapse") : t("common.expand");
        const detailId = `table-detail-${row.id}`;
        return row.getCanExpand() ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-8 text-muted-foreground"
                aria-expanded={expanded}
                aria-controls={detailId}
                aria-label={label}
                onClick={() => row.toggleExpanded()}
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 transition-transform duration-(--duration-base) ease-(--ease-standard) motion-reduce:transition-none",
                    expanded ? "rotate-90" : "rtl:rotate-180",
                  )}
                />
              </EnterpriseButton>
            </TooltipTrigger>
            <TooltipContent side="top">{label}</TooltipContent>
          </Tooltip>
        ) : null;
      },
    };
  }, [canExpandRows, t]);

  const renderedColumns = useMemo<ColumnDef<TData, unknown>[]>(
    () => [
      // Checkbox first, expand/open chevron second — in RTL the first
      // column in this array renders at the true far edge of the table, so
      // this order is what actually produces "Checkbox → Chevron → Data"
      // reading from the right. `columnOrder` (below) re-normalizes this
      // same canonical utility order on top of whatever a user previously
      // persisted, so a stale saved layout can never resurrect the old
      // "Chevron → Checkbox" sequence.
      selectionColumn,
      ...(expandColumn ? [expandColumn] : []),
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
    [columns, selectionColumn, expandColumn, t, isServerMode],
  );

  const resolveRowId = useCallback(
    (row: TData, index: number) =>
      getRowId ? getRowId(row, index) : ((row as { id?: string }).id ?? String(index)),
    [getRowId],
  );

  const defaultHiddenVisibility = useMemo<VisibilityState>(() => {
    const next: VisibilityState = {};
    for (const column of columns) {
      if (column.id && column.meta?.defaultHidden) next[column.id] = false;
    }
    return next;
  }, [columns]);
  const effectiveColumnVisibility = useMemo(
    () => ({ ...defaultHiddenVisibility, ...columnVisibility }),
    [defaultHiddenVisibility, columnVisibility],
  );

  // Re-normalizes the canonical utility-column order (select, then expand)
  // on top of whatever a user has persisted, so a layout saved before this
  // order was corrected — or from before an expand column existed on this
  // table — can never resurrect an invalid utility sequence. Only these two
  // ids are touched; every persisted data-column position is preserved
  // exactly, in its original relative order. A pure derived read, never a
  // write-back, so it self-heals every render without a migration step.
  const normalizedColumnOrder = useMemo<ColumnOrderState>(() => {
    if (columnOrder.length === 0) return columnOrder;
    const canonicalUtilityOrder = ["select", ...(expandColumn ? ["__expand"] : [])];
    const rest = columnOrder.filter((id) => id !== "select" && id !== "__expand");
    return [...canonicalUtilityOrder, ...rest];
  }, [columnOrder, expandColumn]);

  const table = useReactTable({
    data,
    columns: renderedColumns,
    state: {
      rowSelection: effectiveRowSelection,
      columnVisibility: effectiveColumnVisibility,
      columnPinning,
      columnOrder: normalizedColumnOrder,
      // Column filters only ever act on data already in memory, so they
      // stay empty (and inert) in server mode rather than silently
      // filtering just the current page — see `canFilter` on the header.
      columnFilters: isServerMode ? [] : columnFilters,
      sorting,
      pagination,
      // The undebounced draft — client-mode filtering is in-memory and free,
      // so it should react on every keystroke; only the server-mode
      // `onSearchChange` commit (below) is debounced.
      globalFilter: searchDraft,
      expanded,
    },
    getRowId: resolveRowId,
    getRowCanExpand: canExpandRows
      ? (row) => {
          if (getRowCanExpand) return getRowCanExpand(row.original);
          if (!renderExpandedRegions) return false;
          return hasTableDetailContent(renderExpandedRegions(row.original));
        }
      : undefined,
    getExpandedRowModel: canExpandRows ? getExpandedRowModel() : undefined,
    onExpandedChange: setExpanded,
    manualPagination: isServerMode,
    manualSorting: isServerMode,
    manualFiltering: isServerMode,
    enableRowSelection: true,
    enableMultiSort: !isServerMode,
    // One header click: ascending → descending → unsorted. Server mode sorts
    // by exactly one field (the caller's API has no "unsorted"), so there it
    // toggles ascending ↔ descending.
    sortDescFirst: false,
    enableSortingRemoval: !isServerMode,
    enableColumnFilters: !isServerMode,
    ...(isServerMode
      ? {
          pageCount: Math.max(1, Math.ceil((totalCount ?? 0) / pageSize)),
          rowCount: totalCount ?? 0,
        }
      : {}),
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
    onGlobalFilterChange: (value: string) => handleSearchInput(value),
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

  // Scope of the current selection (page / across pages / all matching) —
  // derived from the actual ids against this page and the matching total, so
  // the strip never claims "all matching" when only the page is selected.
  // Once everything matching is selected the strip offers the "use just this
  // page" down-scope; the up-scope lives in the header's scope menu (TASK-064).
  const { scope: selectionScope, count: selectedCount } = getTableSelectionScope(
    table,
    effectiveMatchingSelection,
  );
  const isAllMatchingSelected = selectionScope === "allMatching";
  // Density is ONE lever: `<Table density>` re-points the row-height and
  // cell-padding tokens (ui/table). Neither density shrinks type; line
  // height belongs to the type scale, so tightening a row never clips Arabic.

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
  // `flexRender` wraps ANY function-valued `cell` — including the plain
  // string fallback TanStack merges in for a column with no explicit `cell`
  // — in `React.createElement`, so its output is `isValidElement()` either
  // way. `applySemanticCellContent` needs to know which columns actually
  // authored their own cell tree (and therefore own their own direction)
  // versus which are just the `accessorFn` default, computed from the raw
  // column config *before* TanStack merges in that default.
  //
  // The injected utility columns (the `select` checkbox and the `__expand`
  // chevron) always author their own `cell` too — they are not in the
  // caller's `columns`, so they must be listed explicitly, otherwise their
  // cells fall through to `renderValue()` (no accessor → empty) and only the
  // header's select-all checkbox ever renders.
  const columnsWithExplicitCell = useMemo(
    () =>
      new Set(
        [selectionColumn, ...(expandColumn ? [expandColumn] : []), ...columns]
          .filter((column) => column.cell != null)
          .map((column) => column.id),
      ),
    [columns, selectionColumn, expandColumn],
  );
  const resolvedColumns = useMemo(() => Array.from(layoutById.values()), [layoutById]);
  // The width the table really has (a zero-height sentinel inside its
  // scroller). Once measured, the engine hands `<col>` plain px widths —
  // see `fitColumnWidths` — so identity columns keep their floor and
  // secondary columns give way first.
  const tableMeasureRef = useRef<HTMLDivElement>(null);
  const tableAvailableWidth = useElementWidth(tableMeasureRef);
  // Measured per locale: each header's natural width, and each identity
  // column's full reference (see the measuring effect below the rows).
  const [measuredFloors, setMeasuredFloors] = useState<{
    locale: string;
    values: Record<string, number>;
    content: Record<string, number>;
  }>({ locale, values: {}, content: {} });
  const columnFloors = useMemo(
    () => (measuredFloors.locale === locale ? measuredFloors.values : {}),
    [measuredFloors, locale],
  );
  const contentFloors = measuredFloors.content;
  const columnPlan = useMemo(() => {
    if (!tableAvailableWidth) return null;
    return planColumnWidths(
      resolvedColumns,
      tableAvailableWidth,
      columnWidths,
      columnFloors,
      contentFloors,
    );
  }, [resolvedColumns, tableAvailableWidth, columnWidths, columnFloors, contentFloors]);
  const fittedWidths = columnPlan?.widths ?? null;
  const planHidden = useMemo(() => new Set(columnPlan?.hidden ?? []), [columnPlan]);
  /**
   * Hide class for a column's cells. Once the plan exists the engine decides
   * (it hides low, then medium columns only when they would not fit);
   * before the first measurement the container-query classes stand in.
   */
  const columnHideClass = useCallback(
    (columnId: string, importance: ColumnImportance | undefined) =>
      columnPlan
        ? planHidden.has(columnId)
          ? "hidden"
          : "table-cell"
        : responsiveHideClass(importance ?? "high"),
    [columnPlan, planHidden],
  );
  const detailColumnAxes = useMemo(
    () =>
      visibleLeafColumns.map((column) => {
        const layout = layoutById.get(column.id);
        const utility =
          layout?.type === "checkbox" ||
          layout?.type === "expand" ||
          layout?.type === "actions" ||
          column.id === "__expand" ||
          column.id === "select";
        return {
          id: column.id,
          hideClass: columnHideClass(column.id, layout?.importance),
          utility,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleLeafColumns.map((c) => c.id).join(","), layoutById, columnHideClass],
  );

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

  /**
   * Sticky positioning for a pinned column — logical `insetInlineStart`/`End`
   * so pinning behaves correctly in both LTR and RTL. Layering follows the
   * z-index contract: body cells `--z-pinned`, header/footer cells
   * `--z-sticky-corner` (above the sticky header row they share). Body cells
   * take their fill from the row state (hover/selected) via classes so a
   * pinned cell never shows a different color than the row it belongs to.
   */
  const getPinProps = useCallback(
    (
      columnId: string,
      section: "head" | "body" | "foot",
    ): { style?: React.CSSProperties; className?: string } => {
      const column = table.getColumn(columnId);
      // The row actions never scroll away: when even the rigid floors
      // overflow the region, the actions column sticks to the logical end.
      const pinned =
        column?.getIsPinned() ||
        (columnId === "__actions" && columnPlan?.overflow ? "right" : false);
      if (!pinned) return {};
      const offset =
        (pinned === "left"
          ? pinnedOffsets.left.get(columnId)
          : pinnedOffsets.right.get(columnId)) ?? 0;
      return {
        style: {
          position: "sticky",
          [pinned === "left" ? "insetInlineStart" : "insetInlineEnd"]: offset,
        },
        className: cn(
          // A boundary on whichever side faces the scrollable data.
          pinned === "left" ? "border-e border-e-border" : "border-s border-s-border",
          section === "body"
            ? // Row-state fills (hover/selected) are painted on every cell by
              // the table recipe (theme/recipes.css), overriding this surface.
              "z-(--z-pinned) bg-table-surface"
            : "z-(--z-sticky-corner)",
          section === "foot" && "bg-surface-sunken",
        ),
      };
    },
    [table, pinnedOffsets, columnPlan],
  );

  // Print only real business columns — never the actions/checkbox column,
  // and never a column the user has hidden on screen — through the shared
  // Enterprise Print Engine (never `window.print()` on this page itself).
  // Client mode prints every row matching the current search; server mode
  // asks the page for every matching row (`fetchAllRows`), since there is no
  // "next page" for a printed report.
  const [isPreparingPrint, setIsPreparingPrint] = useState(false);
  const buildPrintPayload = (
    rowsToPrint: TData[],
    extra: Pick<GenericListPrintPayload, "totalRowCount" | "rowScope" | "notes">,
  ): GenericListPrintPayload => {
    const printableColumns = columns.filter(
      (column) =>
        column.id && column.id !== "__actions" && effectiveColumnVisibility[column.id] !== false,
    );
    return {
      variant: "list",
      title: printTitle ?? tableId,
      company: {
        name: printCompany.name,
        logoUrl: printCompany.logoUrl ?? null,
      },
      printedByName: user?.fullName ?? null,
      // Print geometry comes from the column TYPE (narrow dates/references/
      // amounts, flexible text) — never from the user's screen widths.
      columns: printableColumns.map((column) =>
        toPrintColumn(
          { id: column.id!, meta: column.meta },
          column.meta?.titleKey ? t(column.meta.titleKey) : (column.id ?? ""),
        ),
      ),
      rows: rowsToPrint.map((row) =>
        Object.fromEntries(
          printableColumns.map((column) => [column.id!, getColumnDisplayValue(column, row, t)]),
        ),
      ),
      ...extra,
    };
  };
  // The preview tab opens inside the click (before any await) — see `runPrint`.
  const handlePrint = () => {
    if (!isServerMode) {
      printList(
        buildPrintPayload(
          table.getFilteredRowModel().rows.map((row) => row.original),
          {},
        ),
      );
      return;
    }
    if (!fetchAllRows) {
      // Only the loaded page is available — say so on the sheet.
      printList(
        buildPrintPayload(data, {
          ...(totalCount !== undefined && totalCount > data.length
            ? { totalRowCount: totalCount, rowScope: "page" as const }
            : {}),
        }),
      );
      return;
    }
    setIsPreparingPrint(true);
    void runPrint(
      "list",
      async () => {
        const result = await fetchAllRows();
        return buildPrintPayload(result.rows, {
          ...(result.total > result.rows.length
            ? { totalRowCount: result.total, rowScope: "cap" as const }
            : {}),
          ...(result.notes?.length ? { notes: result.notes } : {}),
        });
      },
      "table.loadFailed",
    ).finally(() => setIsPreparingPrint(false));
  };

  // ── Built-in selection tools (`builtInSelectionActions`) ────────────────
  const selectedRecords = useSelectedRecords<TData>({
    items: data,
    rowSelection: effectiveRowSelection,
    getId: resolveRowId,
    fetchAllRows,
    query: selectionQueryKey,
  });

  /** Every row matching the current query in the current sort — in memory (client) or via the bounded `fetchAllRows` (server). `null` when the query moved on meanwhile. */
  const loadMatchingIds = async (): Promise<{ ids: string[]; total: number } | null> => {
    if (!isServerMode) {
      const ids = table.getPrePaginationRowModel().rows.map((row) => row.id);
      return { ids, total: ids.length };
    }
    if (!fetchAllRows) return null;
    const requestedFor = lastSelectionQueryKey.current;
    const result = await fetchAllRows();
    if (lastSelectionQueryKey.current !== requestedFor) return null;
    // Offset paging can repeat a row when records are inserted mid-fetch;
    // duplicates must never make a short set look complete.
    const ids = [...new Set(result.rows.map((row, index) => resolveRowId(row, index)))];
    return { ids, total: result.total };
  };

  const runBuiltInSelection = async (select: (ids: string[], total: number) => void) => {
    setIsBuiltInSelecting(true);
    try {
      const matching = await loadMatchingIds();
      if (matching) select(matching.ids, matching.total);
    } catch (error) {
      reportApiError(error, "errors.selectFailed");
    } finally {
      setIsBuiltInSelecting(false);
    }
  };

  const selectAllMatchingBuiltIn = () =>
    runBuiltInSelection((ids, total) => {
      if (isServerMode) {
        setBuiltInSnapshot(
          createMatchingSelectionSnapshot(lastSelectionQueryKey.current, { ids, total }),
        );
      }
      handleRowSelectionChange(toRowSelection(ids));
      if (ids.length < total) {
        toast.info(t("table.selectionTruncated", { count: ids.length, total }));
      }
    });

  /** "First N" in the current deterministic sort order. */
  const selectFirstBuiltIn = (count: number) =>
    runBuiltInSelection((ids) => {
      const picked = ids.slice(0, count);
      handleRowSelectionChange(toRowSelection(picked));
      if (picked.length < count) {
        toast.info(t("table.customCountPartial", { count: picked.length }));
      }
    });

  useEffect(() => {
    builtInScopeRef.current = {
      selectAll: selectAllMatchingBuiltIn,
      selectFirst: selectFirstBuiltIn,
    };
  });

  /** Exactly the selected records, in the list's current order; `null` (with a reason already shown) when some can't be resolved. */
  const resolveSelectedRows = async (): Promise<TData[] | null> => {
    if (!isServerMode) {
      const rows = table
        .getPrePaginationRowModel()
        .rows.filter((row) => row.getIsSelected())
        .map((row) => row.original);
      if (rows.length === selectedCount) return rows;
    }
    return selectedRecords.resolve();
  };

  const handlePrintSelected = () => {
    if (selectedCount === 0) return;
    setIsPreparingPrint(true);
    void runPrint(
      "list",
      async () => {
        const rows = await resolveSelectedRows();
        if (!rows) return null;
        return buildPrintPayload(rows, {
          notes: [t("table.printSelectionNote", { count: rows.length })],
        });
      },
      "table.loadFailed",
    ).finally(() => setIsPreparingPrint(false));
  };

  const canExportList = Boolean(exportColumns && exportColumns.length > 0 && onExport);
  const [exportScope, setExportScope] = useState<"list" | "selection">("list");
  const exportSelected = async (keys: string[], labels: ExportColumn[]) => {
    const rows = await resolveSelectedRows();
    if (!rows) return;
    const leafById = new Map(
      table.getAllLeafColumns().map((column) => [column.id, column.columnDef] as const),
    );
    const records = rows.map((row) =>
      Object.fromEntries(
        keys.map((key) => {
          const column = leafById.get(key);
          const value = column
            ? getColumnDisplayValue(column, row, t)
            : (row as Record<string, unknown>)[key];
          return [key, value];
        }),
      ),
    );
    exportRowsToCsv(records, keys, `${tableId}-selected.csv`, labels);
    toast.success(t("table.exportedSelected", { count: rows.length }));
  };

  // The table's own utilities, behind the shared overflow menu. These are
  // occasional controls; keeping them out of the strip leaves the filters
  // that actually drive the list as the only labelled things in it.
  const tableOptions: RowAction[] = [
    {
      key: "print",
      label: t("table.print"),
      icon: Printer,
      disabled: isPreparingPrint,
      onSelect: handlePrint,
    },
    {
      key: "import",
      label: t("common.import"),
      icon: Upload,
      hidden: !onImport,
      onSelect: () => setImportDialogOpen(true),
    },
    {
      key: "export",
      label: t("table.export"),
      icon: Download,
      hidden: !canExportList,
      onSelect: () => {
        setExportScope("list");
        setExportDialogOpen(true);
      },
    },
    {
      key: "reset-layout",
      label: t("table.restoreDefaultLayout"),
      icon: RotateCcw,
      separatorBefore: true,
      onSelect: resetLayout,
    },
  ];

  // Filter bar state (narrow containers collapse `filterBar` into one
  // "Filters" button + bottom sheet). A `ClearFiltersButton` inside the
  // filter bar reports its count/reset here; explicit props win.
  const [reportedFilters, setReportedFilters] = useState<Record<string, FilterBarState>>({});
  const reportFilterState = useCallback((id: string, state: FilterBarState | null) => {
    setReportedFilters((previous) => {
      if (!state) {
        if (!(id in previous)) return previous;
        const next = { ...previous };
        delete next[id];
        return next;
      }
      return { ...previous, [id]: state };
    });
  }, []);
  const inlineFilterContext = useMemo(
    () => ({ report: reportFilterState, inSheet: false }),
    [reportFilterState],
  );
  const sheetFilterContext = useMemo(
    () => ({ report: reportFilterState, inSheet: true }),
    [reportFilterState],
  );
  const reportedFilterStates = Object.values(reportedFilters);
  const engagedFilterCount =
    activeFilterCount ??
    reportedFilterStates.reduce((max, state) => Math.max(max, state.activeCount), 0);
  const clearAllFilters =
    onClearFilters ?? reportedFilterStates.find((state) => state.activeCount > 0)?.onClear;
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const hasBulkStrip = Boolean(bulkActions) || builtInSelectionActions;
  const bulkStripOpen = selectedCount > 0 && hasBulkStrip;
  const pageRows = table.getRowModel().rows;
  const mobileSelectHeader = hasBulkStrip
    ? (table.getHeaderGroups()[0]?.headers.find((header) => header.column.id === "select") ?? null)
    : null;
  const hasRows = pageRows.length > 0;
  // Grid draws every row with the grid renderer; otherwise the narrow-container
  // card list uses the page's own mobile renderer (or the automatic card).
  const cardRenderer = isGrid ? renderGridCard : renderMobileRow;

  // Column floors (per locale): each shown header's natural width, and for
  // identity columns the widest reference on this page. Natural widths do
  // not depend on the current column widths, so this converges in one pass;
  // a column that is hidden keeps its last measurement.
  const referenceColumnIds = resolvedColumns
    .filter((layout) => layout.identity || layout.type === "code" || layout.type === "reference")
    .map((layout) => layout.id)
    .join(",");
  useEffect(() => {
    const region = tableMeasureRef.current?.parentElement;
    if (!region || !tableAvailableWidth) return;
    const values: Record<string, number> = { ...columnFloors };
    region.querySelectorAll<HTMLElement>("thead th[data-column-id]").forEach((th) => {
      const id = th.dataset.columnId;
      if (!id || id === "select" || id.startsWith("__") || th.offsetWidth === 0) return;
      values[id] = measureHeaderNeed(th);
    });
    // References: the widest value on this page (a hidden column keeps its
    // last measurement).
    const content: Record<string, number> = {};
    for (const id of referenceColumnIds ? referenceColumnIds.split(",") : []) {
      let need = 0;
      region
        .querySelectorAll<HTMLElement>(`tbody td[data-column-id="${CSS.escape(id)}"]`)
        .forEach((td) => {
          if (td.offsetWidth > 0) need = Math.max(need, measureCellNeed(td));
        });
      content[id] = need > 0 ? Math.min(need, IDENTITY_FLOOR_CAP) : (contentFloors[id] ?? 0);
    }
    const differs = (a: Record<string, number>, b: Record<string, number>) =>
      Object.keys({ ...a, ...b }).some((id) => Math.abs((a[id] ?? 0) - (b[id] ?? 0)) > 1);
    if (differs(values, columnFloors) || differs(content, contentFloors)) {
      setMeasuredFloors({ locale, values, content });
    }
  }, [
    locale,
    pageRows,
    referenceColumnIds,
    planHidden,
    tableAvailableWidth,
    columnFloors,
    contentFloors,
  ]);

  // Column-aligned totals row: explicit `footerRow` over per-column
  // `meta.footer` (a node, or a function of the rows the list describes).
  const footerCells = (() => {
    const hasAnyFooter =
      Boolean(footerRow) ||
      visibleLeafColumns.some((column) => column.columnDef.meta?.footer != null);
    if (!hasAnyFooter) return null;
    let footerRows: TData[] | null = null;
    const rowsForFooter = () =>
      (footerRows ??= isServerMode
        ? data
        : table.getFilteredRowModel().rows.map((row) => row.original));
    const cells = visibleLeafColumns.map((column) => {
      if (footerRow && column.id in footerRow) return footerRow[column.id];
      const footer = column.columnDef.meta?.footer;
      return typeof footer === "function" ? footer({ rows: rowsForFooter() }) : footer;
    });
    return cells.some((cell) => cell != null && cell !== false) ? cells : null;
  })();

  // Re-scan truncated cells (keyboard reachability) when what they render changes.
  const visibleColumnKey = visibleLeafColumns.map((column) => column.id).join(",");
  const overflowScanKey = useMemo(
    () => [
      data,
      visibleColumnKey,
      columnWidths,
      density,
      pagination.pageIndex,
      pagination.pageSize,
    ],
    [data, visibleColumnKey, columnWidths, density, pagination.pageIndex, pagination.pageSize],
  );

  const isUtilityLayout = (columnId: string) => {
    const type = layoutById.get(columnId)?.type;
    return (
      type === "checkbox" ||
      type === "expand" ||
      type === "actions" ||
      columnId === "__expand" ||
      columnId === "select"
    );
  };

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3",
        // Viewport-fill chain (see ListSurface): take the remaining height,
        // but never shrink the grid below a usable floor — the workspace
        // region scrolls instead when a page stacks more around it.
        viewportFill && "lg:min-h-80 lg:flex-1",
      )}
      id={`table-${tableId}`}
    >
      {/* Premium Table Card (TASK-036 V2) — toolbar, grid, and pagination
          live inside one contiguous card so the table never feels like a
          bare HTML element floating on the page. `@container/enterprise-table`
          drives the responsive column-hide engine off the card's own
          available width, not the viewport, since a fixed-width sidebar
          means those two diverge. */}
      <ListSurface className="@container/enterprise-table" fill>
        {/* One strip: what narrows the list on the inline-start, what acts on
            it at the end. Below @3xl the filter bar collapses into one
            "Filters" button (bottom sheet) so the grid starts near the top
            on phones; search and the view controls stay inline. */}
        <ListToolbar>
          <div
            className={cn("contents", bulkStripOpen && "@max-4xl/enterprise-table:hidden")}
            inert={bulkStripOpen}
          >
            <div className="min-w-0 flex-1 basis-40 sm:min-w-48 sm:max-w-88 md:min-w-56 md:max-w-112">
              <SearchInput
                value={searchDraft}
                onValueChange={handleSearchInput}
                onClear={handleSearchClear}
                placeholder={searchPlaceholder ?? t("table.filterPlaceholder")}
                className="w-full max-w-none"
              />
            </div>
            {filterBar ? (
              <FilterBarProvider value={inlineFilterContext}>
                <div className="hidden @3xl/enterprise-table:contents">{filterBar}</div>
                <EnterpriseButton
                  type="button"
                  variant="outline"
                  size="sm"
                  className="@3xl/enterprise-table:hidden"
                  aria-haspopup="dialog"
                  onClick={() => setFilterSheetOpen(true)}
                >
                  <Filter data-icon="inline-start" />
                  {t("table.filters")}
                  {engagedFilterCount > 0 ? (
                    <>
                      <EnterpriseBadge variant="secondary" className="h-4 min-w-4 px-1" aria-hidden>
                        <span className="num">{engagedFilterCount}</span>
                      </EnterpriseBadge>
                      <span className="sr-only">
                        {t("table.activeFilterCount", { count: engagedFilterCount })}
                      </span>
                    </>
                  ) : null}
                </EnterpriseButton>
              </FilterBarProvider>
            ) : null}
            <div className="ms-auto flex shrink-0 items-center gap-1">
              {onRefresh && (
                <IconActionButton
                  label={t("table.refresh")}
                  disabled={isLoading}
                  aria-busy={isLoading || undefined}
                  onClick={onRefresh}
                >
                  <RefreshCw
                    className={cn("size-4", isLoading && "animate-spin motion-reduce:animate-none")}
                  />
                </IconActionButton>
              )}
              {renderGridCard ? (
                <EnterpriseTableViewToggle view={view} onViewChange={setView} />
              ) : null}
              {isGrid ? <EnterpriseTableSortMenu table={table} /> : null}
              <EnterpriseTableDensityControl density={density} onDensityChange={setDensity} />
              {/* Columns configure the table; the Grid has no columns to arrange. */}
              {isGrid ? null : (
                <EnterpriseTableViewOptions
                  table={table}
                  onResetColumnWidths={hasCustomColumnWidths ? resetColumnWidths : undefined}
                />
              )}
              {/* Print/import/export/reset are occasional: as labelled
                  buttons they outweighed the filters they sat beside. */}
              <RowActionsMenu label={t("table.options")} actions={tableOptions} />
            </div>
          </div>

          {/* Contextual bulk-action strip — overlays the toolbar row in place
              while rows are selected (same box, so nothing below moves).
              Feature actions lead, the count (shown only here, never again in
              the footer) sits beside them, and "Clear" trails at the end. */}
          {bulkStripOpen ? (
            <div
              data-bulk-strip=""
              className={cn(
                // Narrow containers (cards): in flow and wrapping — every
                // action stays reachable without sideways scrolling.
                "-mx-3 -my-1.5 flex shrink-0 basis-[calc(100%+1.5rem)] flex-wrap items-center gap-x-3 gap-y-2 bg-table-row-selected px-3 py-2 sm:-mx-4 sm:basis-[calc(100%+2rem)] sm:px-4",
                // Table width: overlays the toolbar row in place.
                "@4xl/enterprise-table:absolute @4xl/enterprise-table:inset-0 @4xl/enterprise-table:z-(--z-sticky) @4xl/enterprise-table:m-0 @4xl/enterprise-table:basis-auto @4xl/enterprise-table:flex-nowrap @4xl/enterprise-table:overflow-x-auto @4xl/enterprise-table:py-0 @4xl/enterprise-table:whitespace-nowrap",
              )}
            >
              <div className="flex flex-wrap items-center gap-2 @4xl/enterprise-table:shrink-0 @4xl/enterprise-table:flex-nowrap">
                {bulkActions}
                {builtInSelectionActions ? (
                  <>
                    <EnterpriseButton
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={isPreparingPrint}
                      aria-busy={isPreparingPrint || undefined}
                      onClick={handlePrintSelected}
                    >
                      <Printer className="size-3.5" aria-hidden />
                      {t("table.printSelected")}
                    </EnterpriseButton>
                    {canExportList ? (
                      <EnterpriseButton
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => {
                          setExportScope("selection");
                          setExportDialogOpen(true);
                        }}
                      >
                        <Download className="size-3.5" aria-hidden />
                        {t("table.exportSelected")}
                      </EnterpriseButton>
                    ) : null}
                  </>
                ) : null}
              </div>
              <span
                className="text-caption font-medium"
                aria-live="polite"
                data-selection-scope={selectionScope}
              >
                <SelectionScopeSummary scope={selectionScope} count={selectedCount} />
              </span>

              {/* "Select all matching filters" lives in the header's own
                  selection-scope menu (TASK-064) — this strip only offers the
                  down-scope action once everything is already selected, plus
                  clear-selection, so it never duplicates that menu's items. */}
              {isAllMatchingSelected && pageRows.length < selectedCount ? (
                <EnterpriseButton
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => {
                    const next: RowSelectionState = {};
                    for (const row of table.getRowModel().rows) {
                      next[row.id] = true;
                    }
                    handleRowSelectionChange(next);
                  }}
                >
                  {t("table.usePageSelection")}
                </EnterpriseButton>
              ) : null}

              <EnterpriseButton
                type="button"
                variant="link"
                size="sm"
                className="ms-auto h-auto shrink-0 p-0 text-muted-foreground"
                onClick={() => handleRowSelectionChange({})}
              >
                {t("table.clearSelection")}
              </EnterpriseButton>
              {/* The strip overlays the toolbar, so the view switch is repeated
                  here: changing view keeps the selection and must stay reachable. */}
              {renderGridCard ? (
                <div className="shrink-0">
                  <EnterpriseTableViewToggle view={view} onViewChange={setView} />
                </div>
              ) : null}
            </div>
          ) : null}
        </ListToolbar>

        {/* Narrow-container card list. Never an inner vertical scroller
            below lg (the page scrolls); in a viewport-fill workspace on lg+
            (a narrow container beside an open sidebar) it is the scroller. */}
        <div
          data-table-view={isGrid ? "grid" : "cards"}
          data-density={density}
          className={cn(
            "group/record-grid",
            // Grid forces this branch at every width; otherwise it is the
            // narrow-container fallback of the table.
            !isGrid && "@4xl/enterprise-table:hidden",
            viewportFill && "lg:min-h-0 lg:flex-1 lg:overflow-y-auto",
          )}
        >
          {isLoading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex flex-col gap-1.5 border-b border-border p-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))
          ) : error ? (
            <ErrorState title={t("table.loadFailed")} description={error} onRetry={onRetry} />
          ) : !hasRows ? (
            <EmptyState icon={Inbox} {...emptyStateProps} />
          ) : (
            <div
              className={cn(
                isGrid &&
                  "grid grid-cols-1 gap-2 p-2 @2xl/enterprise-table:grid-cols-2 @5xl/enterprise-table:grid-cols-3 @7xl/enterprise-table:grid-cols-4 group-data-[density=comfortable]/record-grid:gap-3 group-data-[density=comfortable]/record-grid:p-3",
              )}
            >
              {mobileSelectHeader ? (
                // Phones get the same selection control as the table header:
                // select this page, and the scope menu (all matching, first N,
                // clear) — the header row itself is not rendered for cards.
                <div
                  data-mobile-selection-bar=""
                  className={cn(
                    "flex min-h-(--control-height-sm) items-center gap-2 border-b border-border px-3 py-1.5",
                    isGrid && "col-span-full rounded-md border bg-card",
                  )}
                >
                  {flexRender(
                    mobileSelectHeader.column.columnDef.header,
                    mobileSelectHeader.getContext(),
                  )}
                  <span className="text-caption text-muted-foreground">
                    {t("table.mobileSelectLabel")}
                  </span>
                </div>
              ) : null}
              {pageRows.map((row) =>
                cardRenderer ? (
                  <div key={row.id} data-mobile-row="" data-grid-card={isGrid ? "" : undefined}>
                    {cardRenderer({
                      row: row.original,
                      selected: row.getIsSelected(),
                      onToggleSelected: () => row.toggleSelected(),
                      expanded: row.getIsExpanded(),
                      onToggleExpanded: () => row.toggleExpanded(),
                    })}
                  </div>
                ) : (
                  // Automatic phone card: identity + status on the first line,
                  // the row's own actions in reach, then up to four key fields
                  // as label/value pairs — the same cell renderers as the
                  // desktop table, never a copy. Amounts sit on the numeric
                  // edge with tabular digits.
                  (() => {
                    const cells = row.getVisibleCells();
                    const renderCell = (cell: (typeof cells)[number]) => {
                      const layout = layoutById.get(cell.column.id);
                      const raw = columnsWithExplicitCell.has(cell.column.id)
                        ? flexRender(cell.column.columnDef.cell, cell.getContext())
                        : cell.renderValue<ReactNode>();
                      return applySemanticCellContent(raw, layout?.type);
                    };
                    const selectCell = cells.find((cell) => cell.column.id === "select");
                    const actionsCell = cells.find((cell) => cell.column.id === "__actions");
                    const dataCells = cells.filter(
                      (cell) => cell.column.id !== "select" && !cell.column.id.startsWith("__"),
                    );
                    const titleCell =
                      dataCells.find((cell) => cell.column.columnDef.meta?.identity) ??
                      dataCells[0];
                    const statusCell = dataCells.find(
                      (cell) =>
                        cell !== titleCell && layoutById.get(cell.column.id)?.type === "status",
                    );
                    const detailCells = dataCells
                      .filter((cell) => cell !== titleCell && cell !== statusCell)
                      .slice(0, 4);
                    const rowHref = getRowHref?.(row.original) ?? null;
                    return (
                      <div
                        key={row.id}
                        data-mobile-row=""
                        data-state={row.getIsSelected() ? "selected" : undefined}
                        className="flex flex-col gap-1 border-b border-border p-3 data-[state=selected]:bg-table-row-selected"
                      >
                        <div className="flex min-h-(--control-height-sm) items-center gap-2">
                          {selectCell ? (
                            <div className="shrink-0">{renderCell(selectCell)}</div>
                          ) : null}
                          <div className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
                            {titleCell ? (
                              rowHref ? (
                                <RowIdentityLink href={rowHref}>
                                  <bdi className={bidiLineClass}>{renderCell(titleCell)}</bdi>
                                </RowIdentityLink>
                              ) : (
                                <bdi className={bidiLineClass}>{renderCell(titleCell)}</bdi>
                              )
                            ) : null}
                          </div>
                          {statusCell ? (
                            <div className="shrink-0">{renderCell(statusCell)}</div>
                          ) : null}
                          {actionsCell ? (
                            <div className="shrink-0">{renderCell(actionsCell)}</div>
                          ) : null}
                        </div>
                        {detailCells.length > 0 ? (
                          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                            {detailCells.map((cell) => {
                              const cellType = layoutById.get(cell.column.id)?.type;
                              const numeric = isNumericColumnType(cellType);
                              const copyText = cellCopyText(
                                cellType,
                                getColumnDisplayValue(cell.column.columnDef, row.original, t),
                              );
                              return (
                                <div key={cell.id} className={cn("min-w-0", numeric && "text-end")}>
                                  <dt className="truncate text-caption text-muted-foreground">
                                    {cell.column.columnDef.meta?.titleKey
                                      ? t(cell.column.columnDef.meta.titleKey)
                                      : cell.column.id}
                                  </dt>
                                  <dd
                                    className={cn(
                                      "min-w-0 text-table",
                                      numeric ? "tabular-nums whitespace-nowrap" : "truncate",
                                      copyText && "flex items-center gap-0.5",
                                    )}
                                  >
                                    <bdi
                                      className={cn(
                                        numeric ? undefined : bidiLineClass,
                                        copyText && "min-w-0 truncate",
                                      )}
                                    >
                                      {renderCell(cell)}
                                    </bdi>
                                    {copyText ? (
                                      <CopyButton
                                        value={copyText}
                                        labelKind={cellType === "phone" ? "phone" : "reference"}
                                      />
                                    ) : null}
                                  </dd>
                                </div>
                              );
                            })}
                          </dl>
                        ) : null}
                      </div>
                    );
                  })()
                ),
              )}
            </div>
          )}
        </div>

        {/* Smart Column Engine — a real `<table>` with one `<colgroup>`
            geometry. `table-layout: fixed` makes THEAD, TBODY and TFOOT
            inherit the same column widths; utility columns are px, data
            columns share leftover space by `grow`. This region is the ONE
            scroller: vertical in a viewport-fill workspace on lg+ (sticky
            header/footer), horizontal as the last resort after the
            responsive hide classes drop low/medium columns. */}
        <OverflowTooltipRegion
          scanKey={overflowScanKey}
          className={cn(
            "hidden min-w-0 overflow-x-auto",
            !isGrid && "@4xl/enterprise-table:block",
            viewportFill && "lg:min-h-0 lg:flex-1 lg:overflow-y-auto",
          )}
        >
          <div ref={tableMeasureRef} aria-hidden className="h-0" />
          <Table
            container={false}
            density={density}
            className="w-full table-fixed border-separate border-spacing-0"
            style={{
              minWidth: fittedWidths
                ? Object.values(fittedWidths).reduce((sum, width) => sum + width, 0)
                : columnSetMinWidth(resolvedColumns, columnWidths),
            }}
          >
            <colgroup>
              {visibleLeafColumns.map((column) => {
                const layout = layoutById.get(column.id);
                // A column its responsive class hides (display:none cells)
                // takes no table slot, so it must not keep a <col> either —
                // otherwise every later column inherits its neighbour's width.
                if (fittedWidths && fittedWidths[column.id] === undefined) return null;
                return (
                  <col
                    key={column.id}
                    style={
                      fittedWidths
                        ? { width: `${fittedWidths[column.id] ?? 0}px` }
                        : layout
                          ? { width: columnGeometryWidth(layout, resolvedColumns, columnWidths) }
                          : undefined
                    }
                  />
                );
              })}
            </colgroup>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {headerGroup.headers.map((header, index) => {
                    const layout = layoutById.get(header.id);
                    const isUtility = isUtilityLayout(header.column.id);
                    const isResizable = !isUtility;
                    const sorted = header.column.getIsSorted();
                    const pin = getPinProps(header.id, "head");
                    return (
                      <TableHead
                        key={header.id}
                        data-column-id={header.column.id}
                        aria-sort={
                          sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : undefined
                        }
                        ref={(el) => {
                          headerRefs.current[header.id] = el;
                        }}
                        className={cn(
                          // Each header cell is sticky itself (not the
                          // <thead>) so pinned body cells (--z-pinned) pass
                          // under the header row (--z-sticky) and pinned
                          // header cells (--z-sticky-corner) sit above both.
                          "group/th sticky top-0 z-(--z-sticky) min-w-0 px-0",
                          tableColumnInsetClass(
                            index,
                            headerGroup.headers.length,
                            isUtility ? "utility" : "data",
                          ),
                          tableAlignClass(layout?.align),
                          columnHideClass(header.column.id, layout?.importance),
                          pin.className,
                        )}
                        style={{
                          minWidth: layout?.minWidth ?? undefined,
                          maxWidth: columnWidths[header.id]
                            ? undefined
                            : (layout?.maxWidth ?? undefined),
                          ...pin.style,
                        }}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        {isResizable &&
                          (() => {
                            // Amounts are never clipped: a numeric column
                            // can't be made narrower than its preset.
                            const minWidth = isNumericColumnType(layout?.type)
                              ? Math.max(MIN_COLUMN_WIDTH, layout?.minWidth ?? 0)
                              : MIN_COLUMN_WIDTH;
                            const currentWidth = () =>
                              headerRefs.current[header.id]?.getBoundingClientRect().width ||
                              estimateColumnWidth(header.id);
                            const shownWidth = Math.round(
                              columnWidths[header.id] ??
                                fittedWidths?.[header.id] ??
                                estimateColumnWidth(header.id),
                            );
                            const titleKey = header.column.columnDef.meta?.titleKey;
                            const columnTitle = titleKey ? t(titleKey) : header.id;
                            return (
                              <div
                                role="separator"
                                tabIndex={0}
                                aria-orientation="vertical"
                                aria-label={t("controls.table.resizeHandle", {
                                  column: columnTitle,
                                })}
                                aria-valuenow={shownWidth}
                                aria-valuemin={minWidth}
                                aria-valuemax={MAX_COLUMN_WIDTH}
                                title={t("controls.table.resizeHint")}
                                data-resizing={resizingColumnId === header.id || undefined}
                                onPointerDown={(event) =>
                                  beginResize(header.id, event, currentWidth(), minWidth)
                                }
                                onClick={(event) => event.stopPropagation()}
                                onDoubleClick={(event) => {
                                  event.stopPropagation();
                                  autoFitColumn(header.id, minWidth);
                                }}
                                onKeyDown={(event) =>
                                  handleResizeKey(header.id, event, currentWidth(), minWidth)
                                }
                                className={cn(
                                  // An 8px hit area INSIDE the column's end edge (each
                                  // sticky header cell paints over its neighbour, so
                                  // an overhang would be unhittable) with a hairline
                                  // on the edge, shown on header hover / focus.
                                  "absolute inset-y-0 end-0 z-[1] w-2 cursor-col-resize touch-none select-none outline-none before:absolute before:inset-y-1 before:end-0 before:w-px before:rounded-full before:bg-transparent group-hover/th:before:bg-border-strong hover:before:w-0.5 hover:before:bg-primary/60 focus-visible:before:inset-y-0 focus-visible:before:w-0.5 focus-visible:before:bg-focus-ring data-resizing:before:inset-y-0 data-resizing:before:w-0.5 data-resizing:before:bg-primary",
                                )}
                              />
                            );
                          })()}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            {/* `border-separate` (required for the sticky header + per-column
                pinning) never paints a border set on <tr> itself — the row
                separator therefore lives on each `<TableCell>`; this rule
                strips it off the last row so it never doubles up with the
                list footer's own border-t. */}
            <TableBody className="[&>tr:last-child>td]:border-b-0">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {visibleLeafColumns.map((column, index) => {
                      const layout = layoutById.get(column.id);
                      const stacked = Boolean(column.columnDef.meta?.stacked);
                      const isUtility = isUtilityLayout(column.id);
                      return (
                        <TableCell
                          key={column.id}
                          data-column-id={column.id}
                          className={cn(
                            "min-w-0 px-0 border-b border-table-divider",
                            tableColumnInsetClass(
                              index,
                              visibleLeafColumns.length,
                              isUtility ? "utility" : "data",
                            ),
                            stacked && "whitespace-normal",
                            columnHideClass(column.id, layout?.importance),
                          )}
                        >
                          {stacked ? (
                            <div className="flex flex-col gap-1.5">
                              <Skeleton className="h-4 w-3/4" />
                              <Skeleton className="h-3 w-1/2" />
                            </div>
                          ) : (
                            <Skeleton className="h-4 w-full" />
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              ) : error ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={visibleLeafColumns.length} className="h-auto p-0">
                    <ErrorState
                      title={t("table.loadFailed")}
                      description={error}
                      onRetry={onRetry}
                    />
                  </TableCell>
                </TableRow>
              ) : !hasRows ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={visibleLeafColumns.length} className="h-auto p-0">
                    <EmptyState icon={Inbox} {...emptyStateProps} />
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((row) => {
                  const rowHref = getRowHref?.(row.original) ?? null;
                  return (
                    <Fragment key={row.id}>
                      <TableRow
                        data-state={row.getIsSelected() ? "selected" : undefined}
                        // Hover/selected/focus states come from the shared
                        // TableRow recipe; only a row that navigates on click
                        // is interactive (pointer + hover). The hairline
                        // separator is a per-cell border (below).
                        interactive={Boolean(rowHref && !identityOnlyNavigation)}
                        onClick={
                          rowHref && !identityOnlyNavigation
                            ? (event) => {
                                const target = event.target as HTMLElement;
                                // Interactive children (checkbox, expand chevron,
                                // actions menu, the identity link itself, any
                                // inline control) own their own click — only a
                                // click on inert row space navigates.
                                // `[data-radix-popper-content-wrapper]` covers
                                // every Radix Popper-anchored overlay (Select,
                                // Popover, DropdownMenu, and any cmdk Command
                                // rendered inside a Popover, e.g. EntityCombobox)
                                // even though it's portaled outside the row's own
                                // DOM subtree — React still bubbles the click to
                                // this row handler through the component tree, so
                                // without this guard picking an option from one of
                                // those inline quick-edit controls both saves the
                                // row AND navigates it away.
                                if (
                                  target.closest(
                                    'a, button, input, select, textarea, [role="menuitem"], [role="option"], [data-radix-collection-item], [data-radix-popper-content-wrapper], [contenteditable="true"]',
                                  )
                                ) {
                                  return;
                                }
                                if (window.getSelection()?.toString()) return;
                                router.push(rowHref);
                              }
                            : undefined
                        }
                      >
                        {row.getVisibleCells().map((cell, index) => {
                          const layout = layoutById.get(cell.column.id);
                          const rawContent = columnsWithExplicitCell.has(cell.column.id)
                            ? flexRender(cell.column.columnDef.cell, cell.getContext())
                            : cell.renderValue<ReactNode>();
                          const isIdentity = Boolean(cell.column.columnDef.meta?.identity);
                          // Only the identity column navigates. The row itself
                          // stays inert so the checkbox, chevron and actions menu
                          // sharing it keep unambiguous hit areas.
                          const identityHref = isIdentity ? rowHref : null;
                          const rendered = applySemanticCellContent(rawContent, layout?.type);
                          const content = identityHref ? (
                            <RowIdentityLink href={identityHref}>{rendered}</RowIdentityLink>
                          ) : (
                            rendered
                          );
                          const isWrapped = Boolean(cell.column.columnDef.meta?.wrap);
                          const isStacked =
                            Boolean(cell.column.columnDef.meta?.stacked) ||
                            isStackedCellNode(rendered);
                          const isUtility = isUtilityLayout(cell.column.id);
                          const isNumeric = isNumericColumnType(layout?.type);
                          const displayValue = isUtility
                            ? ""
                            : getColumnDisplayValue(cell.column.columnDef, row.original, t);
                          // Phone/reference cells carry the inline copy button —
                          // never inside the identity link (no button in an <a>).
                          const copyText = identityHref
                            ? null
                            : cellCopyText(layout?.type, displayValue);
                          const pin = getPinProps(cell.column.id, "body");
                          return (
                            <TableCell
                              key={cell.id}
                              data-column-id={cell.column.id}
                              className={cn(
                                "min-w-0 px-0 border-b border-border",
                                tableColumnInsetClass(
                                  index,
                                  row.getVisibleCells().length,
                                  isUtility ? "utility" : "data",
                                ),
                                tableAlignClass(layout?.align),
                                isTabularColumnType(layout?.type) && "tabular-nums",
                                isIdentity && tableIdentityCellClass,
                                columnHideClass(cell.column.id, layout?.importance),
                                (isStacked || isWrapped) && "whitespace-normal",
                                pin.className,
                              )}
                              style={{
                                minWidth: layout?.minWidth ?? undefined,
                                maxWidth: columnWidths[cell.column.id]
                                  ? undefined
                                  : (layout?.maxWidth ?? undefined),
                                ...pin.style,
                              }}
                            >
                              {isUtility || isStacked ? (
                                content
                              ) : isWrapped ? (
                                <div className={tableCellWrapClass}>
                                  <bdi>{content}</bdi>
                                </div>
                              ) : isNumeric ? (
                                // Amounts are never truncated (design-system §6).
                                <div
                                  className="block w-full whitespace-nowrap"
                                  onDoubleClick={() => handleCopyCell(displayValue)}
                                >
                                  <bdi>{content}</bdi>
                                </div>
                              ) : (
                                // Single-line operational values clip on the
                                // inline axis; the region's shared tooltip
                                // shows the full value only when it actually
                                // overflows (hover or keyboard focus).
                                //
                                // Bidi isolation (design-system §2): a plain
                                // "22 Sep 2026" or "2,000.00 USD" from a custom
                                // cell keeps its own order inside an Arabic
                                // row. A start-aligned value is a shrink-wrapped
                                // box, so `plaintext` (direction from content)
                                // only changes where a long Latin value clips —
                                // the box still sits at the cell's start. A
                                // full-width end/center box keeps the cell's
                                // direction and isolates its content instead.
                                (() => {
                                  const value = (
                                    <div
                                      data-overflow-tip=""
                                      className={cn(
                                        tableCellContentClass,
                                        layout?.align === "end" && "block w-full text-end",
                                        layout?.align === "center" && "block w-full text-center",
                                        layout?.align !== "end" &&
                                          layout?.align !== "center" &&
                                          "[unicode-bidi:plaintext]",
                                      )}
                                      onDoubleClick={() => handleCopyCell(displayValue)}
                                    >
                                      {layout?.align === "end" || layout?.align === "center" ? (
                                        <bdi>{content}</bdi>
                                      ) : (
                                        content
                                      )}
                                    </div>
                                  );
                                  // The value truncates; the copy button never does.
                                  return copyText ? (
                                    <div className="group/copy flex min-w-0 items-center gap-0.5">
                                      {value}
                                      <CopyButton
                                        value={copyText}
                                        labelKind={layout?.type === "phone" ? "phone" : "reference"}
                                        className={COPY_REVEAL_CLASS}
                                      />
                                    </div>
                                  ) : (
                                    value
                                  );
                                })()
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                      {row.getIsExpanded() && renderExpandedRegions
                        ? (() => {
                            const detailCells = layoutDetailRegions(
                              detailColumnAxes,
                              renderExpandedRegions(row.original),
                            );
                            const total = visibleLeafColumns.length;
                            return (
                              <TableRow
                                id={`table-detail-${row.id}`}
                                data-slot="table-detail-row"
                                dir={direction}
                                className="bg-surface-sunken hover:bg-surface-sunken"
                              >
                                {detailCells.map((detailCell) => {
                                  const startIndex = visibleLeafColumns.findIndex(
                                    (column) => column.id === detailCell.columnId,
                                  );
                                  const layout = layoutById.get(detailCell.columnId);
                                  const isUtility = isUtilityLayout(detailCell.columnId);
                                  const empty = detailCell.content == null;
                                  const pin = getPinProps(detailCell.columnId, "body");
                                  return (
                                    <TableCell
                                      key={`${row.id}-detail-${detailCell.columnId}`}
                                      data-column-id={detailCell.columnId}
                                      data-empty={empty ? "true" : undefined}
                                      colSpan={detailCell.colSpan}
                                      className={cn(
                                        "h-auto align-top whitespace-normal px-0",
                                        tableColumnInsetClass(
                                          startIndex,
                                          total,
                                          isUtility ? "utility" : "data",
                                        ),
                                        empty || isUtility ? "py-0" : "py-3",
                                        tableAlignClass(layout?.align),
                                        detailCell.hideClass,
                                        pin.className,
                                      )}
                                      style={pin.style}
                                    >
                                      {detailCell.content}
                                    </TableCell>
                                  );
                                })}
                              </TableRow>
                            );
                          })()
                        : null}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
            {footerCells && hasRows && !isLoading && !error ? (
              <TableFooter className="border-t-0">
                <TableRow className="hover:bg-transparent">
                  {visibleLeafColumns.map((column, index) => {
                    const layout = layoutById.get(column.id);
                    const isUtility = isUtilityLayout(column.id);
                    const tabular = isTabularColumnType(layout?.type);
                    const pin = getPinProps(column.id, "foot");
                    return (
                      <TableCell
                        key={column.id}
                        data-column-id={column.id}
                        className={cn(
                          // Sticky at the bottom of the scroller, same inset
                          // and alignment as the body so totals sit under
                          // their own column's values.
                          "sticky bottom-0 z-(--z-sticky) min-w-0 px-0 border-t border-border-strong bg-surface-sunken font-semibold text-foreground",
                          tableColumnInsetClass(
                            index,
                            visibleLeafColumns.length,
                            isUtility ? "utility" : "data",
                          ),
                          tableAlignClass(layout?.align),
                          tabular && "tabular-nums",
                          columnHideClass(column.id, layout?.importance),
                          pin.className,
                        )}
                        style={pin.style}
                      >
                        {footerCells[index] == null ? null : (
                          <span className={cn(tabular && "num")}>{footerCells[index]}</span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </OverflowTooltipRegion>

        <ListFooter>
          <EnterprisePagination table={table} showSelectionCount={!hasBulkStrip} />
        </ListFooter>
      </ListSurface>

      {filterBar ? (
        <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
          <SheetContent
            side="bottom"
            aria-describedby={undefined}
            className="max-h-[calc(100dvh-var(--shell-topbar-height))] gap-0"
          >
            <SheetHeader>
              <SheetTitle>{t("table.filters")}</SheetTitle>
            </SheetHeader>
            <FilterBarProvider value={sheetFilterContext}>
              <div className="flex min-h-0 flex-col items-stretch gap-2 overflow-y-auto px-4 [&>*]:w-full">
                {filterBar}
              </div>
            </FilterBarProvider>
            <SheetFooter className="flex-row justify-end">
              {clearAllFilters && engagedFilterCount > 0 ? (
                <EnterpriseButton type="button" variant="ghost" onClick={clearAllFilters}>
                  {t("table.clearFilters")}
                </EnterpriseButton>
              ) : null}
              <EnterpriseButton type="button" onClick={() => setFilterSheetOpen(false)}>
                {t("table.applyFilters")}
              </EnterpriseButton>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ) : null}

      {exportColumns && onExport && (
        <ExportDialog
          open={exportDialogOpen}
          onOpenChange={setExportDialogOpen}
          columns={exportColumns}
          onExport={(keys, labels) =>
            exportScope === "selection" ? void exportSelected(keys, labels) : onExport(keys, labels)
          }
        />
      )}

      {onImport && (
        <ImportDialog
          open={importDialogOpen}
          onOpenChange={setImportDialogOpen}
          onImport={onImport}
        />
      )}

      {selectCustomCount ? (
        <SelectCustomCountDialog
          open={customCountDialogOpen}
          onOpenChange={setCustomCountDialogOpen}
          isSubmitting={selectCustomCount.isSelecting}
          copy={selectCustomCount.copy}
          onConfirm={async (count) => {
            await selectCustomCount.onSelect(count);
            setCustomCountDialogOpen(false);
          }}
        />
      ) : builtInCustomCount ? (
        <SelectCustomCountDialog
          open={customCountDialogOpen}
          onOpenChange={setCustomCountDialogOpen}
          isSubmitting={isBuiltInSelecting}
          copy={{
            title: t("table.customCountTitle"),
            countLabel: t("table.customCountLabel"),
            hint: (count) => t("table.customCountHint", { count }),
            confirmLabel: t("table.customCountConfirm"),
            invalidMessage: t("table.customCountInvalid"),
          }}
          onConfirm={async (count) => {
            await builtInScopeRef.current?.selectFirst(count);
            setCustomCountDialogOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Foundation CSV export — client-side only, current page's data. Pass the
 * Export dialog's `selectedColumns` as `headerLabels` so the header row is
 * the translated column title (active UI language), not the internal key;
 * cell values and document references are written unchanged.
 */
export function exportRowsToCsv<TData extends Record<string, unknown>>(
  rows: TData[],
  columnKeys: string[],
  filename: string,
  headerLabels?: ExportColumn[],
) {
  const labelFor = new Map((headerLabels ?? []).map((column) => [column.key, column.label]));
  const header = columnKeys
    .map((key) => `"${(labelFor.get(key) ?? key).replace(/"/g, '""')}"`)
    .join(",");
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
