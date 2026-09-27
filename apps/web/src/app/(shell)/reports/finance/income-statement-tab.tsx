"use client";

import { useCallback, useEffect, useState } from "react";
import { FinancialReport, findLine } from "@/components/accounting/financial-report";
import {
  accountingReportsService,
  type HierarchicalReportLine,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";
import { useReportQuery } from "./use-report-query";
import { accountStatementHref } from "./report-url";

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
      reportApiError(error, "common.noResults");
    } finally {
      setIsLoading(false);
    }
  }, [params]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const netIncome = findLine(lines, "net-income")?.values.balance ?? 0;

  return (
    <FinancialReport
      lines={lines}
      columns={[{ key: "balance", labelKey: "reports.finance.fields.balance", emphasize: true }]}
      isLoading={isLoading}
      filters={filters}
      onFiltersChange={setFilters}
      rowHref={(line) =>
        line.accountId && line.kind === "posting"
          ? accountStatementHref(line.accountId, filters)
          : null
      }
      printTitle={t("reports.finance.incomeStatement")}
      exportFileName="income-statement.csv"
      summary={{
        items: [
          {
            id: "totalRevenue",
            label: t("reports.finance.fields.totalRevenue"),
            value: findLine(lines, "revenue:total")?.values.balance ?? 0,
            tone: "revenue",
          },
          {
            id: "totalExpense",
            label: t("reports.finance.fields.totalExpense"),
            value: findLine(lines, "expense:total")?.values.balance ?? 0,
            tone: "expense",
          },
          // The label carries the sign (Net Profit / Net Loss); the figure is
          // the absolute amount, green for a profit, red for a loss.
          {
            id: "netIncome",
            label:
              netIncome < 0
                ? t("reports.finance.fields.netLoss")
                : t("reports.finance.fields.netProfit"),
            value: Math.abs(netIncome),
            emphasize: true,
            tone: netIncome < 0 ? "loss" : netIncome > 0 ? "profit" : "neutral",
          },
        ],
      }}
    />
  );
}
