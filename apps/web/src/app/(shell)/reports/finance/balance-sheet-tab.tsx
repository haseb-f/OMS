"use client";

import { useCallback, useEffect, useState } from "react";
import { FinancialReport } from "@/components/accounting/financial-report";
import {
  accountingReportsService,
  type HierarchicalReportLine,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { useReportQuery } from "./use-report-query";

export function BalanceSheetTab() {
  const { t } = useLocale();
  const { filters, setFilters, params } = useReportQuery();
  const [lines, setLines] = useState<HierarchicalReportLine[]>([]);
  const [totals, setTotals] = useState({
    totalAssets: 0,
    totalLiabilities: 0,
    totalEquity: 0,
    balanced: true,
  });
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await accountingReportsService.balanceSheet(params);
      setLines(result.lines ?? []);
      setTotals(result.totals);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsLoading(false);
    }
  }, [params, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <FinancialReport
      lines={lines}
      columns={[{ key: "balance", labelKey: "reports.finance.fields.balance", emphasize: true }]}
      isLoading={isLoading}
      filters={filters}
      onFiltersChange={setFilters}
      printTitle={t("reports.finance.balanceSheet")}
      exportFileName="balance-sheet.csv"
      footer={{
        balanced: totals.balanced,
        values: { balance: totals.totalAssets },
      }}
    />
  );
}
