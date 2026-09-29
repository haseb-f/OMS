"use client";

import { useCallback, useEffect, useState } from "react";
import { FinancialReport } from "@/components/accounting/financial-report";
import {
  ReportWarnings,
  reportWarningNotes,
} from "@/components/accounting/financial-report/report-warnings";
import {
  accountingReportsService,
  type BalanceSheetResult,
  type HierarchicalReportLine,
  type ReportWarning,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";
import { useReportQuery } from "./use-report-query";
import { accountStatementHref, financeReportHref } from "./report-url";

const EMPTY_TOTALS: BalanceSheetResult["totals"] = {
  totalAssets: 0,
  totalLiabilities: 0,
  totalEquity: 0,
  balanced: true,
};

export function BalanceSheetTab() {
  const { t } = useLocale();
  const { filters, setFilters, params } = useReportQuery();
  const [lines, setLines] = useState<HierarchicalReportLine[]>([]);
  const [totals, setTotals] = useState<BalanceSheetResult["totals"]>(EMPTY_TOTALS);
  const [warnings, setWarnings] = useState<ReportWarning[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await accountingReportsService.balanceSheet(params);
      setLines(result.lines ?? []);
      setTotals(result.totals);
      // An unbalanced statement names the entries whose lines do not net to zero.
      const unbalanced = result.discrepancy?.unbalancedEntries ?? [];
      setWarnings([
        ...(result.warnings ?? []),
        ...(unbalanced.length > 0
          ? [{ code: "UNBALANCED_ENTRIES" as const, entries: unbalanced }]
          : []),
      ]);
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

  const liabilitiesAndEquity =
    totals.totalLiabilitiesAndEquity ?? totals.totalLiabilities + totals.totalEquity;

  return (
    <FinancialReport
      lines={lines}
      columns={[{ key: "balance", labelKey: "reports.finance.fields.balance", emphasize: true }]}
      isLoading={isLoading}
      filters={filters}
      onFiltersChange={setFilters}
      // Point-in-time: the Balance Sheet reads only an "as of" date.
      filterFields={[
        "company",
        "branch",
        "costCenter",
        "project",
        "currency",
        "asOf",
        "postedOnly",
      ]}
      rowHref={(line) =>
        line.accountId && line.kind === "posting"
          ? accountStatementHref(line.accountId, filters)
          : null
      }
      printTitle={t("reports.finance.balanceSheet")}
      exportFileName="balance-sheet.csv"
      notice={warnings.length > 0 ? <ReportWarnings warnings={warnings} /> : undefined}
      summary={{
        notes: reportWarningNotes(warnings, t),
        items: [
          {
            id: "totalAssets",
            label: t("reports.finance.fields.totalAssets"),
            value: totals.totalAssets,
            emphasize: true,
          },
          {
            id: "totalLiabilities",
            label: t("reports.finance.fields.totalLiabilities"),
            value: totals.totalLiabilities,
          },
          {
            id: "totalEquity",
            label: t("reports.finance.fields.totalEquity"),
            value: totals.totalEquity,
          },
          {
            id: "currentYearProfit",
            label: t("reports.finance.statementSummary.currentYearProfit"),
            value: totals.currentYearProfit ?? 0,
            tone: "result",
            hint: t("reports.finance.statementSummary.currentYearProfitHint"),
          },
          {
            id: "cashAndCashEquivalents",
            label: t("reports.finance.statementSummary.cashEquivalents"),
            value: totals.cashAndCashEquivalents ?? 0,
          },
        ],
        // Assets = liabilities + equity at the report date; the combined
        // right-hand side is one of the two compared totals.
        check: {
          balanced: totals.balanced,
          difference: totals.difference ?? totals.totalAssets - liabilitiesAndEquity,
          label: t("docFlow.reports.assetsEqualLiabilitiesEquity"),
          scope: "asOf",
          sides: [
            {
              id: "totalLiabilitiesAndEquity",
              label: t("reports.finance.fields.totalLiabilitiesAndEquity"),
              value: liabilitiesAndEquity,
            },
          ],
          drillDown: {
            href: financeReportHref("trialBalance", filters),
            label: t("reports.finance.reconciliation.viewTrialBalance"),
          },
        },
      }}
    />
  );
}
