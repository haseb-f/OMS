"use client";

import { useCallback, useMemo } from "react";
import { ViewportFillProvider } from "@/components/shared/data-table/list-surface";
import {
  FinancialReportChromeProvider,
  ReportSwitcher,
  type ReportSwitcherOption,
} from "@/components/accounting/financial-report";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import { GeneralLedgerTab } from "./general-ledger-tab";
import { TrialBalanceTab } from "./trial-balance-tab";
import { JournalReportTab } from "./journal-report-tab";
import { AccountStatementTab } from "./account-statement-tab";
import { BalanceSheetTab } from "./balance-sheet-tab";
import { IncomeStatementTab } from "./income-statement-tab";
import { CashFlowTab } from "./cash-flow-tab";
import { CashAvailabilityTab } from "./cash-availability-tab";
import { AgingTab } from "./aging-tab";
import { PartnerStatementTab } from "./partner-statement-tab";
import { PermissionGate } from "@/components/shared/permission-gate";
import { useReportUrlParam } from "./use-report-query";
import { FINANCE_REPORTS, type FinanceReportKey } from "./report-url";

/** Switcher groups, in menu order. */
const REPORT_GROUP: Record<FinanceReportKey, MessageKey> = {
  generalLedger: "reports.finance.header.groups.ledgers",
  trialBalance: "reports.finance.header.groups.ledgers",
  journalReport: "reports.finance.header.groups.ledgers",
  accountStatement: "reports.finance.header.groups.ledgers",
  balanceSheet: "reports.finance.header.groups.statements",
  incomeStatement: "reports.finance.header.groups.statements",
  cashFlow: "reports.finance.header.groups.statements",
  cashAvailability: "reports.finance.header.groups.cash",
  arAging: "reports.finance.header.groups.partners",
  apAging: "reports.finance.header.groups.partners",
  customerStatement: "reports.finance.header.groups.partners",
  supplierStatement: "reports.finance.header.groups.partners",
};

/**
 * Menu hierarchy (usability-financial-reports §3): Financial reports (root) →
 * Ledgers & entries → Financial statements → Receivables & payables → Cash.
 * Cash availability is an operational cash-position view, not a statement,
 * so it keeps its own group last rather than diluting the statements group.
 */
const MENU_ORDER: FinanceReportKey[] = [
  "generalLedger",
  "trialBalance",
  "journalReport",
  "accountStatement",
  "balanceSheet",
  "incomeStatement",
  "cashFlow",
  "arAging",
  "apAging",
  "customerStatement",
  "supplierStatement",
  "cashAvailability",
];

/**
 * Financial reports — ONE header block per report (design-system §11.5): the
 * page hands the title and the report switcher to the report, which renders
 * title + context + actions, the filter row, the summary strip and the table.
 * The viewport-fill contract (design-system §6) keeps the grid the only
 * scroller on desktop.
 */
function ReportsFinancePageContent() {
  const { t } = useLocale();
  const [report, setReport] = useReportUrlParam<FinanceReportKey>(
    "report",
    FINANCE_REPORTS,
    "trialBalance",
  );
  const reportLabel = useCallback(
    (key: FinanceReportKey) => {
      if (key === "accountStatement") return t("reports.finance.accountStatement.title");
      if (key === "customerStatement") return t("reports.finance.customerStatement");
      if (key === "supplierStatement") return t("reports.finance.supplierStatement");
      return t(`reports.finance.${key}` as never);
    },
    [t],
  );
  const options = useMemo<ReportSwitcherOption[]>(
    () =>
      MENU_ORDER.map((key) => ({
        value: key,
        label: reportLabel(key),
        group: t(REPORT_GROUP[key]),
      })),
    [reportLabel, t],
  );
  const chrome = useMemo(
    () => ({
      title: reportLabel(report),
      switcher: (
        <ReportSwitcher
          title={t("reports.finance.header.groups.root")}
          value={report}
          options={options}
          onChange={(value) => setReport(value as FinanceReportKey)}
        />
      ),
    }),
    [options, report, reportLabel, setReport, t],
  );

  return (
    <ViewportFillProvider value>
      <div
        data-viewport-fill=""
        className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
      >
        <FinancialReportChromeProvider value={chrome}>
          {report === "generalLedger" ? <GeneralLedgerTab /> : null}
          {report === "trialBalance" ? <TrialBalanceTab /> : null}
          {report === "journalReport" ? <JournalReportTab /> : null}
          {report === "accountStatement" ? <AccountStatementTab /> : null}
          {report === "balanceSheet" ? <BalanceSheetTab /> : null}
          {report === "incomeStatement" ? <IncomeStatementTab /> : null}
          {report === "cashFlow" ? <CashFlowTab /> : null}
          {report === "cashAvailability" ? <CashAvailabilityTab /> : null}
          {report === "arAging" ? <AgingTab side="AR" /> : null}
          {report === "apAging" ? <AgingTab side="AP" /> : null}
          {report === "customerStatement" ? <PartnerStatementTab role="CUSTOMER" /> : null}
          {report === "supplierStatement" ? <PartnerStatementTab role="SUPPLIER" /> : null}
        </FinancialReportChromeProvider>
      </div>
    </ViewportFillProvider>
  );
}

export default function ReportsFinancePage() {
  return (
    <PermissionGate permission="reports.financial.view">
      <ReportsFinancePageContent />
    </PermissionGate>
  );
}
