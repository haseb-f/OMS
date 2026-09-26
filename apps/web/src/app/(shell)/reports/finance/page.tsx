"use client";

import { useCallback, useMemo } from "react";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { useLocale } from "@/providers/locale-provider";
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

const REPORTS = [
  "generalLedger",
  "trialBalance",
  "journalReport",
  "accountStatement",
  "balanceSheet",
  "incomeStatement",
  "cashFlow",
  "cashAvailability",
  "arAging",
  "apAging",
  "customerStatement",
  "supplierStatement",
] as const;

type ReportKey = (typeof REPORTS)[number];

function ReportsFinancePageContent() {
  const { t } = useLocale();
  const [report, setReport] = useReportUrlParam<ReportKey>("report", REPORTS, "trialBalance");
  const reportLabel = useCallback(
    (key: ReportKey) => {
      if (key === "accountStatement") return t("reports.finance.accountStatement.title");
      if (key === "customerStatement") return t("reports.finance.customerStatement");
      if (key === "supplierStatement") return t("reports.finance.supplierStatement");
      return t(`reports.finance.${key}` as never);
    },
    [t],
  );
  const title = useMemo(() => reportLabel(report), [report, reportLabel]);

  return (
    <PageWorkspace
      dense
      title={title}
      actions={
        // A report must always be selected (no "All"), so this is a searchable
        // single select rather than a SelectFilter; the URL param stays the source of truth.
        <SearchableSelect
          value={report}
          onValueChange={(value) => {
            if (value) setReport(value as ReportKey);
          }}
          options={REPORTS.map((key) => ({ value: key, label: reportLabel(key) }))}
          aria-label={t("pickers.labels.financeReport")}
        />
      }
    >
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
    </PageWorkspace>
  );
}

export default function ReportsFinancePage() {
  return (
    <PermissionGate permission="reports.financial.view">
      <ReportsFinancePageContent />
    </PermissionGate>
  );
}
