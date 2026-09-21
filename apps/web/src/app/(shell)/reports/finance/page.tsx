"use client";

import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { useLocale } from "@/providers/locale-provider";
import { GeneralLedgerTab } from "./general-ledger-tab";
import { TrialBalanceTab } from "./trial-balance-tab";
import { JournalReportTab } from "./journal-report-tab";
import { AccountStatementTab } from "./account-statement-tab";
import { BalanceSheetTab } from "./balance-sheet-tab";
import { IncomeStatementTab } from "./income-statement-tab";
import { CashFlowTab } from "./cash-flow-tab";
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
  "arAging",
  "apAging",
  "customerStatement",
  "supplierStatement",
] as const;

type ReportKey = (typeof REPORTS)[number];

function ReportsFinancePageContent() {
  const { t } = useLocale();
  const [report, setReport] = useReportUrlParam<ReportKey>("report", REPORTS, "trialBalance");
  const title = useMemo(() => {
    if (report === "accountStatement") return t("reports.finance.accountStatement.title");
    if (report === "customerStatement") return t("reports.finance.customerStatement");
    if (report === "supplierStatement") return t("reports.finance.supplierStatement");
    return t(`reports.finance.${report}` as never);
  }, [report, t]);

  return (
    <PageWorkspace
      dense
      title={title}
      actions={
        <Select value={report} onValueChange={(value) => setReport(value as ReportKey)}>
          <SelectTrigger className="w-56 sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REPORTS.map((key) => (
              <SelectItem key={key} value={key}>
                {key === "accountStatement"
                  ? t("reports.finance.accountStatement.title")
                  : key === "customerStatement"
                    ? t("reports.finance.customerStatement")
                    : key === "supplierStatement"
                      ? t("reports.finance.supplierStatement")
                      : t(`reports.finance.${key}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {report === "generalLedger" ? <GeneralLedgerTab /> : null}
      {report === "trialBalance" ? <TrialBalanceTab /> : null}
      {report === "journalReport" ? <JournalReportTab /> : null}
      {report === "accountStatement" ? <AccountStatementTab /> : null}
      {report === "balanceSheet" ? <BalanceSheetTab /> : null}
      {report === "incomeStatement" ? <IncomeStatementTab /> : null}
      {report === "cashFlow" ? <CashFlowTab /> : null}
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
