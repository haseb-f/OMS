import type { RowSelectionState } from "@tanstack/react-table";

/** Client bulk-selection mode for EnterpriseDataTable consumers. */
export type BulkSelectionMode = "page" | "ids" | "filter";

export interface BulkSelectionState {
  mode: BulkSelectionMode;
  /** Inclusion map when mode is page/ids. Ignored for filter (except exclusions). */
  rowSelection: RowSelectionState;
  /** Rows unchecked after select-all-matching (filter mode). */
  excludeIds: string[];
  /** Total matching the current filters when mode is filter. */
  filterMatchCount: number | null;
}

export function createEmptyBulkSelection(): BulkSelectionState {
  return {
    mode: "page",
    rowSelection: {},
    excludeIds: [],
    filterMatchCount: null,
  };
}

export function selectedIdList(selection: BulkSelectionState): string[] {
  if (selection.mode === "filter") return [];
  return Object.entries(selection.rowSelection)
    .filter(([, selected]) => selected)
    .map(([id]) => id);
}

export function bulkSelectionCount(selection: BulkSelectionState): number {
  if (selection.mode === "filter") {
    const total = selection.filterMatchCount ?? 0;
    return Math.max(0, total - selection.excludeIds.length);
  }
  return selectedIdList(selection).length;
}

/** Payload for APIs that accept BulkSelectionDto. */
export function toBulkSelectionPayload(
  selection: BulkSelectionState,
  filters?: Record<string, unknown>,
):
  | { mode: "ids"; ids: string[]; excludeIds?: string[] }
  | { mode: "filter"; filters: Record<string, unknown>; excludeIds?: string[] } {
  if (selection.mode === "filter") {
    return {
      mode: "filter",
      filters: filters ?? {},
      ...(selection.excludeIds.length ? { excludeIds: selection.excludeIds } : {}),
    };
  }
  return {
    mode: "ids",
    ids: selectedIdList(selection),
  };
}
