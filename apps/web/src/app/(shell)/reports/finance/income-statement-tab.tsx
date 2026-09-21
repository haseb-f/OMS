"use client";

import { useCallback, useEffect, useState } from "react";
import { FinancialReport, findLine } from "@/components/accounting/financial-report";
import {
  accountingReportsService,
  type HierarchicalReportLine,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { useReportQuery } from "./use-report-query";

export function IncomeStatementTab() {
  const { t } = useLocale();
  const { filters, setFilters, params } = useReportQuery();
  const [lines, setLines] = useState<HierarchicalReportLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await accountingReportsService.incomeStatement(params);
      setLines(result.lines ?? []);
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
      printTitle={t("reports.finance.incomeStatement")}
      exportFileName="income-statement.csv"
      summary={{
        items: [
          {
            label: t("reports.finance.fields.totalRevenue"),
            value: findLine(lines, "revenue:total")?.values.balance ?? 0,
            tone: "revenue",
          },
          {
            label: t("reports.finance.fields.totalExpense"),
            value: findLine(lines, "expense:total")?.values.balance ?? 0,
            tone: "expense",
          },
          {
            label:
              (findLine(lines, "net-income")?.values.balance ?? 0) < 0
                ? t("reports.finance.fields.netLoss")
                : t("reports.finance.fields.netProfit"),
            value: findLine(lines, "net-income")?.values.balance ?? 0,
            emphasize: true,
            tone: "result",
          },
        ],
      }}
    />
  );
}
