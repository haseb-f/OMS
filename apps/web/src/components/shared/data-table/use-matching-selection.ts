"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RowSelectionState } from "@tanstack/react-table";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, toast } from "@/lib/toast";
import {
  createMatchingSelectionSnapshot,
  matchingSelectionShortfall,
  selectionQuerySignature,
  toRowSelection,
  type MatchingIdsResult,
  type MatchingSelectionSnapshot,
} from "./bulk-selection";

/**
 * Server-side "select all matching" for an `EnterpriseDataTable` page
 * (tables-selection.md). One place for the rules every list shares:
 *
 * - `queryKey` → pass as the table's `selectionResetKey` (any filter/search/
 *   sort change clears the selection);
 * - `matchingSelection` → pass to the table; "All N matching results" is
 *   shown only while the selection equals the complete id set returned for
 *   the CURRENT query;
 * - ids that arrive after the query changed mid-request are dropped;
 * - a truncated (ids cap) or capped (profitability window) result selects
 *   what came back, says so, and is labelled "across pages", never "all".
 */
export function useMatchingSelection(query: unknown) {
  const { t } = useLocale();
  const queryKey = selectionQuerySignature(query);
  const currentQuery = useRef(queryKey);
  useEffect(() => {
    currentQuery.current = queryKey;
  }, [queryKey]);

  const [snapshot, setSnapshot] = useState<MatchingSelectionSnapshot | null>(null);
  const [isSelectingAllMatching, setIsSelectingAllMatching] = useState(false);

  /** Runs an ids request for the current query; resolves `null` when the query changed meanwhile. */
  const fetchForCurrentQuery = useCallback(
    async <R extends MatchingIdsResult>(fetchIds: () => Promise<R>): Promise<R | null> => {
      const requestedFor = currentQuery.current;
      const result = await fetchIds();
      return currentQuery.current === requestedFor ? result : null;
    },
    [],
  );

  const selectAllMatching = useCallback(
    async (
      fetchIds: () => Promise<MatchingIdsResult>,
      setRowSelection: (next: RowSelectionState) => void,
    ) => {
      setIsSelectingAllMatching(true);
      try {
        const requestedFor = currentQuery.current;
        const result = await fetchIds();
        if (currentQuery.current !== requestedFor) return;
        setSnapshot(createMatchingSelectionSnapshot(requestedFor, result));
        setRowSelection(toRowSelection(result.ids));
        const shortfall = matchingSelectionShortfall(result);
        if (shortfall === "capped") {
          toast.info(t("table.selectionMayBeIncomplete", { count: result.ids.length }));
        } else if (shortfall === "truncated") {
          toast.info(
            t("table.selectionTruncated", { count: result.ids.length, total: result.total }),
          );
        }
      } catch (error) {
        reportApiError(error, "errors.selectFailed");
      } finally {
        setIsSelectingAllMatching(false);
      }
    },
    [t],
  );

  return {
    queryKey,
    matchingSelection: snapshot?.query === queryKey ? snapshot : null,
    isSelectingAllMatching,
    selectAllMatching,
    fetchForCurrentQuery,
  };
}

/**
 * Checks a bulk action's selected count against its endpoint limit
 * (`lib/bulk-limits.ts`) BEFORE opening or submitting, with a localized
 * explanation instead of the server's raw 400. Returns false when over.
 */
export function useBulkLimitGuard() {
  const { t } = useLocale();
  return useCallback(
    (count: number, limit: number) => {
      if (count <= limit) return true;
      toast.error(t("table.bulkLimitExceeded", { count, limit }));
      return false;
    },
    [t],
  );
}
