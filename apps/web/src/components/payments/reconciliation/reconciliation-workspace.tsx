"use client";

import { useCallback, useEffect, useState } from "react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { DismissibleAlert } from "@/components/shared/dismissible-alert";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/shared/error-state";
import { PageLoading } from "@/components/shared/page-loading";
import { StatusBadge } from "@/components/business/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AwaitingSettlementTab, SettlementsTab } from "@/components/payments/settlement";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import {
  paymentReconciliationService,
  type ReconciliationMethod,
  type StatementLine,
} from "@/services/payment-reconciliation-service";
import { CurrencyTotalsList } from "./currency-totals";
import { StatementTab } from "./statement-tab";
import { MatchingTab } from "./matching-tab";
import { StatementLinesTable } from "./statement-lines-table";

type WorkspaceTab = "statement" | "matching" | "awaitingSettlement" | "settlements" | "exceptions";
const TABS: WorkspaceTab[] = [
  "statement",
  "matching",
  "awaitingSettlement",
  "settlements",
  "exceptions",
];

/** Per-currency summary strip: reported/awaiting, unmatched statement, awaiting settlement, disputed — never one "Paid" flag. */
export function MethodSummaryStrip({ method }: { method: ReconciliationMethod }) {
  const { t } = useLocale();
  const summary = method.summary;
  return (
    <div
      role="group"
      aria-label={t("paymentReconciliation.workspace.summaryLabel")}
      className="grid grid-cols-2 gap-x-3 gap-y-2 lg:grid-cols-4 lg:[&>*+*]:border-s lg:[&>*+*]:border-border lg:[&>*+*]:ps-3"
    >
      <CurrencyTotalsList
        label={t("paymentReconciliation.list.awaitingReconciliation")}
        totals={summary?.claimsAwaitingReconciliation}
      />
      <CurrencyTotalsList
        label={t("paymentReconciliation.list.unmatchedLines")}
        totals={summary?.unmatchedByCurrency}
      />
      <CurrencyTotalsList
        label={t("paymentReconciliation.list.awaitingSettlement")}
        totals={summary?.awaitingSettlement}
      />
      <CurrencyTotalsList
        label={t("paymentReconciliation.list.disputed")}
        totals={summary?.disputedClaims}
      />
    </div>
  );
}

/** `/finance/payment-reconciliation/[methodId]` — one shared workspace for any reconciliation-enabled method. */
export function ReconciliationWorkspace({ methodId }: { methodId: string }) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canImport = hasPermission("finance.payment-reconciliation.import");
  const canMatch = hasPermission("finance.payment-reconciliation.match");
  const canCorrect = hasPermission("finance.payment-reconciliation.correct");

  const [method, setMethod] = useState<ReconciliationMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>("statement");
  const [focusLineId, setFocusLineId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadMethod = useCallback(async () => {
    try {
      const result = await paymentReconciliationService.getMethod(methodId);
      setMethod(result);
      setError(
        result.requiresReconciliation === false
          ? t("paymentReconciliation.workspace.notFound")
          : null,
      );
    } catch {
      setError(t("paymentReconciliation.workspace.notFound"));
    }
  }, [methodId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMethod();
  }, [loadMethod, refreshKey]);

  const changed = useCallback(() => setRefreshKey((key) => key + 1), []);
  const matchLine = useCallback((line: StatementLine) => {
    setFocusLineId(line.id);
    setTab("matching");
  }, []);

  if (error) return <ErrorState title={error} />;
  if (!method) return <PageLoading />;

  const exceptions = method.summary?.lines.EXCEPTION ?? 0;
  return (
    <PageWorkspace
      title={method.name}
      description={
        method.account
          ? `${t("paymentReconciliation.list.clearingAccount")}: ${method.account.code} ${method.account.name}`
          : t("paymentReconciliation.list.noAccount")
      }
      actions={
        !method.isActive ? (
          <StatusBadge label={t("paymentReconciliation.list.inactive")} tone="neutral" />
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        {/* Persistent until fixed: a method without a clearing account can never post a match. */}
        {!method.account ? (
          <DismissibleAlert
            tone="warning"
            dismissible={false}
            title={t("paymentReconciliation.workspace.noAccountTitle")}
          >
            {t("paymentReconciliation.workspace.noAccountBody")}
          </DismissibleAlert>
        ) : null}
        {!method.isActive ? (
          <DismissibleAlert
            tone="info"
            dismissKey={`recon-inactive-${method.id}`}
            title={t("paymentReconciliation.workspace.inactiveTitle")}
          >
            {t("paymentReconciliation.workspace.inactiveBody")}
          </DismissibleAlert>
        ) : null}

        {/* Compact summary strip — one surface, figures separated by hairlines. */}
        <EnterpriseCard size="sm">
          <EnterpriseCardContent>
            <MethodSummaryStrip method={method} />
          </EnterpriseCardContent>
        </EnterpriseCard>

        <Tabs value={tab} onValueChange={(value) => setTab(value as WorkspaceTab)}>
          <TabsList variant="line" className="max-w-full flex-wrap overflow-x-auto">
            {TABS.map((value) => (
              <TabsTrigger key={value} value={value} className="gap-1.5">
                {t(`paymentReconciliation.tabs.${value}`)}
                {value === "exceptions" && exceptions > 0 ? (
                  <StatusBadge label={String(exceptions)} tone="destructive" />
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="statement" className="pt-3">
            <StatementTab
              methodId={methodId}
              canImport={canImport}
              canMatch={canMatch}
              canCorrect={canCorrect}
              refreshKey={refreshKey}
              onChanged={changed}
              onMatchLine={matchLine}
            />
          </TabsContent>
          <TabsContent value="matching" className="pt-3">
            <MatchingTab
              methodId={methodId}
              focusLineId={focusLineId}
              canMatch={canMatch}
              refreshKey={refreshKey}
              onChanged={changed}
            />
          </TabsContent>
          <TabsContent value="awaitingSettlement" className="pt-3">
            <AwaitingSettlementTab methodId={methodId} />
          </TabsContent>
          <TabsContent value="settlements" className="pt-3">
            <SettlementsTab methodId={methodId} />
          </TabsContent>
          <TabsContent value="exceptions" className="pt-3">
            <StatementLinesTable
              methodId={methodId}
              tableId="payment-reconciliation-exceptions"
              statuses={["EXCEPTION", "IGNORED"]}
              defaultStatus="EXCEPTION"
              refreshKey={refreshKey}
              canMatch={canMatch}
              canCorrect={canCorrect}
              onChanged={changed}
              emptyTitle={t("paymentReconciliation.exceptions.empty")}
            />
          </TabsContent>
        </Tabs>
      </div>
    </PageWorkspace>
  );
}
