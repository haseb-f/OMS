"use client";

import { useCallback, useEffect, useState } from "react";
import { FinancialReport, findLine } from "@/components/accounting/financial-report";
import {
  ReportWarnings,
  reportWarningNotes,
} from "@/components/accounting/financial-report/report-warnings";
import {
  accountingReportsService,
  type HierarchicalReportLine,
  type ReportWarning,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";
import { useReportQuery } from "./use-report-query";
import { accountStatementHref } from "./report-url";

export function IncomeStatementTab() {
  const { t } = useLocale();
  const { filters, setFilters, params } = useReportQuery();
  const [lines, setLines] = useState<HierarchicalReportLine[]>([]);
  const [warnings, setWarnings] = useState<ReportWarning[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await accountingReportsService.incomeStatement(params);
      setLines(result.lines ?? []);
      setWarnings(result.warnings ?? []);
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
      notice={warnings.length > 0 ? <ReportWarnings warnings={warnings} /> : undefined}
      summary={{
        notes: reportWarningNotes(warnings, t),
        items: [
          {
            id: "netRevenue",
            label: t("reports.finance.statementSummary.netRevenue"),
            value:
              findLine(lines, "is-net-revenue")?.values.balance ??
              findLine(lines, "is-revenue:total")?.values.balance ??
              0,
            tone: "revenue",
            hint: t("reports.finance.statementSummary.netRevenueHint"),
          },
          {
            id: "grossProfit",
            label: t("reports.finance.statementSummary.grossProfit"),
            value: findLine(lines, "is-gross-profit")?.values.balance ?? 0,
            tone: "result",
            hint: t("reports.finance.statementSummary.grossProfitHint"),
          },
          {
            id: "operatingProfit",
            label: t("reports.finance.statementSummary.operatingProfit"),
            value: findLine(lines, "is-operating-profit")?.values.balance ?? 0,
            tone: "result",
            hint: t("reports.finance.statementSummary.operatingProfitHint"),
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
            cardLabel:
              netIncome < 0
                ? t("reports.finance.summaryCards.netLossPeriod")
                : t("reports.finance.summaryCards.netProfitPeriod"),
            hint: t("reports.finance.statementSummary.netHint"),
          },
        ],
      }}
    />
  );
}
