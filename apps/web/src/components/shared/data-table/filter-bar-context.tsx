"use client";

import { createContext, useContext, useEffect, useId, useRef } from "react";

/**
 * Lets a list's filter bar tell its `EnterpriseDataTable` how many filters
 * are engaged and how to reset them — without every page threading that
 * through props. `ClearFiltersButton` (the one reset control every filter
 * bar already renders) reports here; the table uses it for the collapsed
 * "Filters" button badge and the filter sheet's Clear action on narrow
 * containers.
 */
export interface FilterBarState {
  activeCount: number;
  onClear: () => void;
}

interface FilterBarContextValue {
  report: (id: string, state: FilterBarState | null) => void;
  /** True for the copy of the filter bar rendered inside the narrow-container filter sheet. */
  inSheet: boolean;
}

const FilterBarContext = createContext<FilterBarContextValue | null>(null);

export const FilterBarProvider = FilterBarContext.Provider;

export function useFilterBarContext() {
  return useContext(FilterBarContext);
}

/** Reports a filter bar's engaged-filter count + reset to the enclosing table, if any. */
export function useReportFilterBarState(activeCount: number, onClear: () => void) {
  const context = useContext(FilterBarContext);
  const id = useId();
  const onClearRef = useRef(onClear);
  useEffect(() => {
    onClearRef.current = onClear;
  });
  const report = context?.report;
  useEffect(() => {
    if (!report) return;
    report(id, { activeCount, onClear: () => onClearRef.current() });
  }, [report, id, activeCount]);
  useEffect(() => {
    if (!report) return;
    return () => report(id, null);
  }, [report, id]);
  return context;
}
