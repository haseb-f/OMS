"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { useLocale } from "@/providers/locale-provider";
import { GeneralLedgerTab } from "./general-ledger-tab";
import { TrialBalanceTab } from "./trial-balance-tab";
import { JournalReportTab } from "./journal-report-tab";
import { AccountStatementTab } from "./account-statement-tab";
import { BalanceSheetTab } from "./balance-sheet-tab";
import { IncomeStatementTab } from "./income-statement-tab";
import { CashFlowTab } from "./cash-flow-tab";
import { PermissionGate } from "@/components/shared/permission-gate";

/**
 * TASK-047 Financial Reports (General Ledger Foundation) — read-only
 * reports over the Journal Entries the Posting Engine (TASK-046) already
 * produces. Same shape as `reports/inventory/page.tsx` (TASK-029): one page,
 * one Tabs shell, each tab a self-contained report. Never creates or
 * modifies accounting data — every figure here is derived from
 * `JournalEntryLine` rows at request time.
 */
function ReportsFinancePageContent() {
  const { t } = useLocale();

  return (
    <PageWorkspace title={t("nav.reportsFinance")} description={t("reports.finance.description")}>
      <Tabs defaultValue="generalLedger">
        <TabsList variant="line" className="flex-wrap">
          <TabsTrigger value="generalLedger">{t("reports.finance.generalLedger")}</TabsTrigger>
          <TabsTrigger value="trialBalance">{t("reports.finance.trialBalance")}</TabsTrigger>
          <TabsTrigger value="journalReport">{t("reports.finance.journalReport")}</TabsTrigger>
          <TabsTrigger value="accountStatement">
            {t("reports.finance.accountStatement.title")}
          </TabsTrigger>
          <TabsTrigger value="balanceSheet">{t("reports.finance.balanceSheet")}</TabsTrigger>
          <TabsTrigger value="incomeStatement">{t("reports.finance.incomeStatement")}</TabsTrigger>
          <TabsTrigger value="cashFlow">{t("reports.finance.cashFlow")}</TabsTrigger>
        </TabsList>

        <TabsContent value="generalLedger">
          <GeneralLedgerTab />
        </TabsContent>
        <TabsContent value="trialBalance">
          <TrialBalanceTab />
        </TabsContent>
        <TabsContent value="journalReport">
          <JournalReportTab />
        </TabsContent>
        <TabsContent value="accountStatement">
          <AccountStatementTab />
        </TabsContent>
        <TabsContent value="balanceSheet">
          <BalanceSheetTab />
        </TabsContent>
        <TabsContent value="incomeStatement">
          <IncomeStatementTab />
        </TabsContent>
        <TabsContent value="cashFlow">
          <CashFlowTab />
        </TabsContent>
      </Tabs>
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
