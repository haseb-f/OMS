"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FinancialReport,
  type FinancialReportColumn,
} from "@/components/accounting/financial-report";
import {
  accountingReportsService,
  type HierarchicalReportLine,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";
import { useReportQuery } from "./use-report-query";
import { accountStatementHref, financeReportHref } from "./report-url";

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
      reportApiError(error, "common.noResults");
    } finally {
      setIsLoading(false);
    }
  }, [params, includeOpeningBalance]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Balances are debit-positive: shown with a Dr/Cr side, never a red minus.
  const columns: FinancialReportColumn[] = [
    ...(includeOpeningBalance
      ? [
          {
            key: "opening",
            labelKey: "reports.finance.fields.openingBalance",
            negative: "drcr" as const,
          },
        ]
      : []),
    { key: "debit", labelKey: "reports.finance.fields.debit" },
    { key: "credit", labelKey: "reports.finance.fields.credit" },
    {
      key: "closing",
      labelKey: "reports.finance.fields.closingBalance",
      emphasize: true,
      negative: "drcr",
    },
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
      rowHref={(line) =>
        line.accountId && line.kind === "posting"
          ? accountStatementHref(line.accountId, filters)
          : null
      }
      printTitle={t("reports.finance.trialBalance")}
      exportFileName="trial-balance.csv"
      summary={{
        // Period debits and credits are the figures that count — shown once,
        // in the reconciliation card; the net closing balance of all
        // accounts is ~0 by construction (footer).
        items: [],
        check: {
          balanced,
          difference: totals.debitTotal - totals.creditTotal,
          label: t("docFlow.reports.debitsEqualCredits"),
          scope: "period",
          sides: [
            {
              id: "debitTotal",
              label: t("reports.finance.fields.debitTotal"),
              value: totals.debitTotal,
            },
            {
              id: "creditTotal",
              label: t("reports.finance.fields.creditTotal"),
              value: totals.creditTotal,
            },
          ],
          drillDown: {
            href: financeReportHref("journalReport", filters),
            label: t("reports.finance.reconciliation.viewPeriodEntries"),
          },
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
