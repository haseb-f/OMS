"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReportFilterValue } from "@/components/accounting/report-filter-bar";
import { toISODate } from "@/lib/date";
import type { ReportFilterParams } from "@/services/accounting-reports-service";
import { filtersFromSearchParams, writeFiltersToSearchParams } from "./report-url";

/**
 * A report tab's filters: initialised from the URL (a drill-down, reload or
 * shared link lands on the same scope) and written back to it on change.
 */
export function useReportQuery() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<ReportFilterValue>(() =>
    filtersFromSearchParams(searchParams),
  );

  const params = useMemo<ReportFilterParams>(
    () => ({
      companyId: filters.companyId || undefined,
      branchId: filters.branchId || undefined,
      costCenterId: filters.costCenterId || undefined,
      projectId: filters.projectId || undefined,
      currencyId: filters.currencyId || undefined,
      dateFrom: filters.dateRange.from ? toISODate(filters.dateRange.from) : undefined,
      dateTo: filters.dateRange.to ? toISODate(filters.dateRange.to) : undefined,
      postedOnly: filters.postedOnly,
    }),
    [filters],
  );

  const setReportFilters = useCallback(
    (next: ReportFilterValue) => {
      setFilters(next);
      const query = writeFiltersToSearchParams(
        next,
        new URLSearchParams(window.location.search),
      ).toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  return { filters, setFilters: setReportFilters, params };
}

/**
 * One report choice kept in the URL (`?report=…`, `?view=…`) so a reload,
 * a shared link, or Back returns to exactly the same report and view.
 * Other query params are preserved; the default value is omitted.
 */
export function useReportUrlParam<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams.get(key);
  const value = raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;

  const setValue = useCallback(
    (next: T) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === fallback) params.delete(key);
      else params.set(key, next);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [fallback, key, pathname, router, searchParams],
  );

  return [value, setValue];
}
