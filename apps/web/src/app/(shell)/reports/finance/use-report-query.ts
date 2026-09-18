"use client";

import { useCallback, useMemo, useState } from "react";
import {
  EMPTY_REPORT_FILTERS,
  type ReportFilterValue,
} from "@/components/accounting/report-filter-bar";
import { toISODate } from "@/lib/date";
import type { ReportFilterParams } from "@/services/accounting-reports-service";

export function useReportQuery() {
  const [filters, setFilters] = useState<ReportFilterValue>(EMPTY_REPORT_FILTERS);

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

  const setReportFilters = useCallback((next: ReportFilterValue) => {
    setFilters(next);
  }, []);

  return { filters, setFilters: setReportFilters, params };
}
