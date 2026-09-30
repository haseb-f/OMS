"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RowSelectionState } from "@tanstack/react-table";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, toast } from "@/lib/toast";
import { selectionQuerySignature } from "./bulk-selection";

/** Selected ids in the order they were selected (object key order). */
export function selectedIdsOf(rowSelection: RowSelectionState): string[] {
  return Object.keys(rowSelection).filter((id) => rowSelection[id]);
}

/**
 * Orders `ids` by the order of `ordered` (a list in the current sort), with
 * ids not in it appended in their own order — bulk print/export follow the
 * list the user sees, never the order rows happened to be selected in.
 */
export function orderSelectedIds(ids: readonly string[], ordered: readonly string[]): string[] {
  const wanted = new Set(ids);
  const result = ordered.filter((id) => wanted.has(id));
  if (result.length === ids.length) return result;
  const placed = new Set(result);
  return [...result, ...ids.filter((id) => !placed.has(id))];
}

const defaultGetId = (item: unknown) => (item as { id: string }).id;

/**
 * The records behind a table's row selection — across every page, not just
 * the loaded one (tables-selection.md §4). `selectedRecords` holds the
 * selected records known right now (the loaded page plus anything already
 * fetched); `resolve()` fetches whatever is still missing through the page's
 * bounded `fetchAllRows` (the CURRENT query) and fails closed with a reason
 * when some selected records still can't be found, so a bulk print/export/
 * archive never silently acts on fewer records than the strip says.
 *
 * `query` is the caller's filter/search/sort (the table's `selectionResetKey`):
 * fetched records are forgotten when it changes, together with the selection,
 * and whenever the page reloads (`items` changes — e.g. after a mutation), so
 * eligibility is never judged on records older than the list on screen.
 * `resolve({ fresh: true })` always refetches (state-changing bulk actions).
 */
export function useSelectedRecords<T>({
  items,
  rowSelection,
  getId = defaultGetId,
  fetchAllRows,
  query,
}: {
  items: readonly T[];
  rowSelection: RowSelectionState;
  getId?: (item: T, index: number) => string;
  fetchAllRows?: () => Promise<{ rows: T[]; total: number }>;
  query?: unknown;
}) {
  const { t } = useLocale();
  const signature = selectionQuerySignature(query ?? null);
  const [fetched, setFetched] = useState<{
    query: string;
    items: readonly T[];
    rows: readonly T[];
  } | null>(null);
  const currentQuery = useRef(signature);
  useEffect(() => {
    currentQuery.current = signature;
  }, [signature]);

  const { byId, order } = useMemo(() => {
    const map = new Map<string, T>();
    const ids: string[] = [];
    if (fetched?.query === signature && fetched.items === items) {
      fetched.rows.forEach((row, index) => {
        const id = getId(row, index);
        map.set(id, row);
        ids.push(id);
      });
    }
    // The loaded page is the freshest copy of its rows.
    const pageIds = items.map((item, index) => {
      const id = getId(item, index);
      map.set(id, item);
      return id;
    });
    return { byId: map, order: ids.length > 0 ? ids : pageIds };
  }, [fetched, signature, items, getId]);

  const selectedIds = selectedIdsOf(rowSelection);
  const selectedRecords = orderSelectedIds(selectedIds, order)
    .map((id) => byId.get(id))
    .filter((item): item is T => item !== undefined);

  const reportUnavailable = useCallback(
    (resolved: number, selected: number) =>
      toast.error(t("table.bulkRowsUnavailable"), {
        description: t("table.bulkRowsUnavailableDetail", { resolved, selected }),
      }),
    [t],
  );

  const resolve = useCallback(
    async ({ fresh = false }: { fresh?: boolean } = {}): Promise<T[] | null> => {
      const ids = selectedIdsOf(rowSelection);
      if (ids.length === 0) return null;
      let known = byId;
      let knownOrder = order;
      if (fresh || ids.some((id) => !known.has(id))) {
        if (!fetchAllRows) {
          reportUnavailable(ids.filter((id) => known.has(id)).length, ids.length);
          return null;
        }
        try {
          const requestedFor = currentQuery.current;
          const { rows } = await fetchAllRows();
          // The filters moved on meanwhile: the selection was cleared with them.
          if (currentQuery.current !== requestedFor) return null;
          const next = fresh ? new Map<string, T>() : new Map(known);
          knownOrder = rows.map((row, index) => {
            const id = getId(row, index);
            next.set(id, row);
            return id;
          });
          known = next;
          setFetched({ query: signature, items, rows });
        } catch (error) {
          reportApiError(error, "table.loadFailed");
          return null;
        }
      }
      const resolved = orderSelectedIds(ids, knownOrder)
        .map((id) => known.get(id))
        .filter((item): item is T => item !== undefined);
      if (resolved.length !== ids.length) {
        reportUnavailable(resolved.length, ids.length);
        return null;
      }
      return resolved;
    },
    [byId, order, fetchAllRows, getId, items, rowSelection, signature, reportUnavailable],
  );

  return { selectedIds, selectedRecords, resolve };
}
