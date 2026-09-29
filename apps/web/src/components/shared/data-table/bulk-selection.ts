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

/**
 * What a table's current row selection covers — drives the bulk strip's
 * wording so it never implies more than is actually selected
 * (usability-financial-reports `tables-selection.md`):
 *
 * - `page`        — every selected row is on the page being shown.
 * - `acrossPages` — rows picked on more than one page (or a "first N" pick).
 * - `allMatching` — every record matching the current filters/search.
 */
export type SelectionScope = "none" | "page" | "acrossPages" | "allMatching";

/**
 * What a server "select all matching" (`GET …/ids`) returned, and for which
 * query. "All matching" is claimed only while the selection still equals
 * exactly this id set, the query is unchanged, and the result was complete
 * (every match returned — not truncated at the ids cap, not a capped
 * profitability window).
 */
export interface MatchingSelectionSnapshot {
  /** `selectionQuerySignature` of the query the ids were fetched for. */
  query: string;
  ids: readonly string[];
  /** The server's full match count for that query. */
  total: number;
  complete: boolean;
}

export interface MatchingIdsResult {
  ids: string[];
  total: number;
  /** Store Orders: the Cost State / Loss-Making window was full — the set may be incomplete. */
  profitabilityFilterCapped?: boolean;
}

export function createMatchingSelectionSnapshot(
  query: string,
  result: MatchingIdsResult,
): MatchingSelectionSnapshot {
  return {
    query,
    ids: result.ids,
    total: result.total,
    complete: !result.profitabilityFilterCapped && result.ids.length >= result.total,
  };
}

/** Why a "select all matching" result is not the whole match set (null = it is). */
export function matchingSelectionShortfall(
  result: MatchingIdsResult,
): "capped" | "truncated" | null {
  if (result.profitabilityFilterCapped) return "capped";
  if (result.ids.length < result.total) return "truncated";
  return null;
}

export function toRowSelection(ids: readonly string[]): RowSelectionState {
  return Object.fromEntries(ids.map((id) => [id, true]));
}

function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return set.size === b.length && b.every((id) => set.has(id));
}

export interface SelectionScopeInput {
  selectedIds: readonly string[];
  /** Ids of the rows rendered on the current page. */
  pageRowIds: readonly string[];
  /**
   * Client mode: the exact ids matching the current filters — "all matching"
   * requires every matching id selected and nothing selected outside them.
   */
  matchingIds?: readonly string[];
  /** Server mode: the last "select all matching" result (see `MatchingSelectionSnapshot`). */
  matchingSelection?: MatchingSelectionSnapshot | null;
  /** Server mode: signature of the query shown now; a snapshot for another query never counts. */
  currentQuery?: string;
}

/**
 * Never inferred from counts: a selection whose size merely reaches the
 * total (e.g. a stale selection, or a full page) is NOT "all matching".
 */
export function resolveSelectionScope({
  selectedIds,
  pageRowIds,
  matchingIds,
  matchingSelection,
  currentQuery,
}: SelectionScopeInput): SelectionScope {
  if (selectedIds.length === 0) return "none";

  if (matchingIds) {
    if (matchingIds.length > 0 && sameIdSet(selectedIds, matchingIds)) return "allMatching";
  } else if (
    matchingSelection &&
    matchingSelection.complete &&
    (currentQuery === undefined || matchingSelection.query === currentQuery) &&
    sameIdSet(selectedIds, matchingSelection.ids)
  ) {
    return "allMatching";
  }

  const page = new Set(pageRowIds);
  return selectedIds.every((id) => page.has(id)) ? "page" : "acrossPages";
}

/** i18n key (in `table.*`) of the bulk strip's scope summary; each takes `{count}`. */
export function selectionScopeMessageKey(
  scope: Exclude<SelectionScope, "none">,
):
  | "table.selectionScopePage"
  | "table.selectionScopeAcrossPages"
  | "table.selectionScopeAllMatching" {
  switch (scope) {
    case "page":
      return "table.selectionScopePage";
    case "acrossPages":
      return "table.selectionScopeAcrossPages";
    case "allMatching":
      return "table.selectionScopeAllMatching";
  }
}

function normalizeQueryValue(value: unknown): unknown {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (Array.isArray(value)) {
    const items = value.map(normalizeQueryValue).filter((item) => item !== undefined);
    if (items.length === 0) return undefined;
    return items.every((item) => typeof item !== "object" || item === null)
      ? [...items].sort((a, b) => String(a).localeCompare(String(b)))
      : items;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, normalizeQueryValue(entry)] as const)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  if (value === null || value === "") return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  return value;
}

/**
 * Stable signature of "the query a selection belongs to" (filters, search,
 * sort). Key order, multi-select value order and empty values (`undefined`,
 * `null`, `""`, `[]`) never change it, so only a real filter change clears a
 * selection. `false` and `0` are kept — they can be meaningful filter values.
 */
export function selectionQuerySignature(query: unknown): string {
  return JSON.stringify(normalizeQueryValue(query) ?? null);
}
