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

export function TrialBalanceTab() {
  const { t } = useLocale();
  const { filters, setFilters, params } = useReportQuery();
  const [includeOpeningBalance, setIncludeOpeningBalance] = useState(true);
  const [lines, setLines] = useState<HierarchicalReportLine[]>([]);
  const [totals, setTotals] = useState({
    debitTotal: 0,
    creditTotal: 0,
    openingBalance: 0,
    closingBalance: 0,
  });
  const [balanced, setBalanced] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await accountingReportsService.trialBalance({
        ...params,
        includeOpeningBalance,
      });
      setLines(result.lines ?? []);
      setTotals({
        debitTotal: result.totals.debitTotal,
        creditTotal: result.totals.creditTotal,
        openingBalance: result.totals.openingBalance ?? 0,
        closingBalance: result.totals.closingBalance ?? 0,
      });
      setBalanced(
        result.balanced ?? Math.abs(result.totals.debitTotal - result.totals.creditTotal) < 0.01,
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsLoading(false);
    }
  }, [params, includeOpeningBalance, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns = includeOpeningBalance
    ? [
        { key: "opening", labelKey: "reports.finance.fields.openingBalance" },
        { key: "debit", labelKey: "reports.finance.fields.debit" },
        { key: "credit", labelKey: "reports.finance.fields.credit" },
        { key: "closing", labelKey: "reports.finance.fields.closingBalance", emphasize: true },
      ]
    : [
        { key: "debit", labelKey: "reports.finance.fields.debit" },
        { key: "credit", labelKey: "reports.finance.fields.credit" },
        { key: "closing", labelKey: "reports.finance.fields.closingBalance", emphasize: true },
      ];

  return (
    <FinancialReport
      lines={lines}
      columns={columns}
      isLoading={isLoading}
      filters={filters}
      onFiltersChange={setFilters}
      includeOpeningBalance={includeOpeningBalance}
      onIncludeOpeningBalanceChange={setIncludeOpeningBalance}
      printTitle={t("reports.finance.trialBalance")}
      exportFileName="trial-balance.csv"
      summary={{
        items: [
          { label: t("reports.finance.fields.debit"), value: totals.debitTotal },
          { label: t("reports.finance.fields.credit"), value: totals.creditTotal },
          {
            label: t("reports.finance.fields.closingBalance"),
            value: totals.closingBalance,
            emphasize: true,
          },
        ],
        check: {
          balanced,
          difference: totals.debitTotal - totals.creditTotal,
          label: t("docFlow.reports.debitsEqualCredits"),
        },
      }}
      footer={{
        values: includeOpeningBalance
          ? {
              opening: totals.openingBalance,
              debit: totals.debitTotal,
              credit: totals.creditTotal,
              closing: totals.closingBalance,
            }
          : {
              debit: totals.debitTotal,
              credit: totals.creditTotal,
              closing: totals.closingBalance,
            },
      }}
    />
  );
}
