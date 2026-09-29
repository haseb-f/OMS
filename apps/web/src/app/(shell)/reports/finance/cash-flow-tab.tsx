"use client";

import { useCallback, useEffect, useState } from "react";
import { FinancialReport, findLine } from "@/components/accounting/financial-report";
import type {
  FinancialReportColumn,
  FinancialReportSummary,
} from "@/components/accounting/financial-report";
import {
  ReportWarnings,
  reportWarningNotes,
} from "@/components/accounting/financial-report/report-warnings";
import { formatAmount } from "@/lib/money";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  accountingReportsService,
  type CashFlowResult,
  type CashFlowView,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";
import { useReportQuery, useReportUrlParam } from "./use-report-query";

const VIEWS = ["activities", "movement"] as const satisfies readonly CashFlowView[];

const MOVEMENT_COLUMNS: FinancialReportColumn[] = [
  { key: "opening", labelKey: "reports.finance.fields.openingBalance" },
  { key: "inflow", labelKey: "reports.finance.cashFlowSections.inflowsDebit" },
  { key: "outflow", labelKey: "reports.finance.cashFlowSections.outflowsCredit" },
  { key: "netChange", labelKey: "reports.finance.fields.netChange" },
  { key: "closing", labelKey: "reports.finance.fields.closingBalance", emphasize: true },
];

const ACTIVITY_COLUMNS: FinancialReportColumn[] = [
  { key: "balance", labelKey: "reports.finance.fields.netChange", emphasize: true },
];

export function CashFlowTab() {
  const { t } = useLocale();
  const { filters, setFilters, params } = useReportQuery();
  const [view, setView] = useReportUrlParam<CashFlowView>("view", VIEWS, "activities");
  const [result, setResult] = useState<CashFlowResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setResult(await accountingReportsService.cashFlow({ ...params, view }));
    } catch (error) {
      reportApiError(error, "common.noResults");
    } finally {
      setIsLoading(false);
    }
  }, [params, view]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Never render one view's rows under the other view's columns while the
  // new request is in flight.
  const lines = result && (result.view ?? "activities") === view ? result.lines : [];
  const isMovement = view === "movement";
  const totals = result?.totals;
  const reconciliation = !isMovement ? result?.reconciliation : undefined;
  const transfersNote =
    reconciliation && reconciliation.internalTransfers >= 0.005
      ? t("reports.finance.statementSummary.internalTransfers", {
          amount: formatAmount(reconciliation.internalTransfers),
        })
      : null;

  const summary: FinancialReportSummary = isMovement
    ? {
        items: [
          {
            id: "openingCash",
            label: t("reports.finance.cashFlowSections.openingCash"),
            value: totals?.openingBalance ?? 0,
          },
          {
            id: "inflows",
            label: t("reports.finance.cashFlowSections.inflows"),
            value: totals?.inflows ?? 0,
          },
          {
            id: "outflows",
            label: t("reports.finance.cashFlowSections.outflows"),
            value: totals?.outflows ?? 0,
          },
          {
            id: "netChange",
            label: t("reports.finance.cashFlowSections.netChange"),
            value: totals?.netCashChange ?? 0,
            tone: "result",
          },
          {
            id: "closingCash",
            label: t("reports.finance.cashFlowSections.closingCash"),
            value: totals?.closingBalance ?? 0,
            emphasize: true,
          },
        ],
      }
    : {
        items: [
          {
            id: "openingCash",
            label: t("reports.finance.cashFlowSections.openingCash"),
            value: findLine(lines, "cf-opening")?.values.balance ?? 0,
          },
          ...(reconciliation && Math.abs(reconciliation.openingBalanceEntries) >= 0.005
            ? [
                {
                  id: "openingBalanceEntries",
                  label: t("reports.finance.statementSummary.openingEntries"),
                  value: reconciliation.openingBalanceEntries,
                },
              ]
            : []),
          {
            id: "operating",
            label: t("reports.finance.statementSummary.operating"),
            value: reconciliation?.operating ?? 0,
            tone: "result",
          },
          {
            id: "investing",
            label: t("reports.finance.statementSummary.investing"),
            value: reconciliation?.investing ?? 0,
            tone: "result",
          },
          {
            id: "financing",
            label: t("reports.finance.statementSummary.financing"),
            value: reconciliation?.financing ?? 0,
            tone: "result",
          },
          ...(reconciliation && Math.abs(reconciliation.fxEffect) >= 0.005
            ? [
                {
                  id: "fxEffect",
                  label: t("reports.finance.statementSummary.fxEffect"),
                  value: reconciliation.fxEffect,
                  tone: "result" as const,
                },
              ]
            : []),
          {
            id: "closingCash",
            label: t("reports.finance.cashFlowSections.closingCash"),
            value: findLine(lines, "cf-closing")?.values.balance ?? 0,
            emphasize: true,
          },
        ],
        notes: reportWarningNotes(result?.warnings, t, transfersNote),
        // Opening + activities (+ FX effect) must land on the cash accounts'
        // own as-of balance, aggregated independently by the API — the
        // statement's proof, not a formatting claim.
        check: reconciliation
          ? {
              balanced: reconciliation.balanced,
              difference: reconciliation.difference,
              label: t("reports.finance.statementSummary.cashCheck"),
              scope: "period",
              sides: [
                {
                  id: "computedClosing",
                  label: t("reports.finance.statementSummary.computedClosing"),
                  value: reconciliation.closingCash,
                },
                {
                  id: "ledgerClosing",
                  label: t("reports.finance.statementSummary.ledgerClosing"),
                  value: reconciliation.ledgerClosingCash,
                },
              ],
            }
          : undefined,
      };

  const viewLabel = t(`reports.finance.cashFlowView.${view}`);

  return (
    <FinancialReport
      lines={lines}
      columns={isMovement ? MOVEMENT_COLUMNS : ACTIVITY_COLUMNS}
      isLoading={isLoading}
      filters={filters}
      onFiltersChange={setFilters}
      printTitle={`${t("reports.finance.cashFlow")} — ${viewLabel}`}
      exportFileName={`cash-flow-${view}.csv`}
      nameHeaderKey={isMovement ? "reports.finance.cashFlowSections.cashAccount" : undefined}
      footer={
        isMovement && totals
          ? {
              values: {
                opening: totals.openingBalance ?? 0,
                inflow: totals.inflows ?? 0,
                outflow: totals.outflows ?? 0,
                netChange: totals.netCashChange,
                closing: totals.closingBalance,
              },
            }
          : undefined
      }
      summary={summary}
      notice={
        !isMovement && ((result?.warnings?.length ?? 0) > 0 || transfersNote) ? (
          <ReportWarnings warnings={result?.warnings} extra={transfersNote} />
        ) : undefined
      }
      toolbarExtra={
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(next) => {
            if (next) setView(next as CashFlowView);
          }}
          aria-label={t("reports.finance.cashFlowView.label")}
        >
          {VIEWS.map((key) => (
            <ToggleGroupItem key={key} value={key} size="default">
              {t(`reports.finance.cashFlowView.${key}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      }
    />
  );
}
