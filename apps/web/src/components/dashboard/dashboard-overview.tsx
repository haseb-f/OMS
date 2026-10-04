"use client";

import { useMemo, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { ErrorState } from "@/components/shared/error-state";
import { AttentionPanel } from "@/components/dashboard/attention-panel";
import { BankMatchingPanel } from "@/components/dashboard/bank-matching-panel";
import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { DashboardShortcuts } from "@/components/dashboard/dashboard-shortcuts";
import {
  ActivityPanel,
  PERIOD_LABEL_KEY,
  RankingPanel,
  SalesOverviewPanel,
} from "@/components/dashboard/sales-panels";
import {
  SALES_PERIODS,
  anyPeriodKpis,
  buildAttentionQueues,
  loadBankMatchingSummary,
  loadPendingFigures,
  loadSalesByPeriod,
  summarizeBankMatching,
  useLoad,
} from "@/components/dashboard/dashboard-data";
import { useLocale } from "@/providers/locale-provider";
import type { SalesPeriod } from "@/services/sales-performance-service";

export interface DashboardAccess {
  /** Lead or store-order figures (sales performance endpoint). */
  sales: boolean;
  /** The leads list itself (drill-down link). */
  leads: boolean;
  /** The store-orders list itself (drill-down link). */
  orders: boolean;
  paymentReview: boolean;
  bank: boolean;
}

/**
 * The home dashboard (design-system §12.6): calm panels on one grid.
 * Main column — sales performance for the selected period, activity to date,
 * bank matching. Side column — needs attention, then the ranking. On phones
 * the order is attention → performance → activity → bank → ranking.
 * Every figure is real and every panel is permission-gated.
 */
export function DashboardOverview({ access }: { access: DashboardAccess }) {
  const { t } = useLocale();
  const [period, setPeriod] = useState<SalesPeriod>("month");

  const salesLoader = useMemo(
    () => () => (access.sales ? loadSalesByPeriod() : Promise.resolve(null)),
    [access.sales],
  );
  const pendingLoader = useMemo(
    () => () => loadPendingFigures(access.paymentReview, access.bank),
    [access.paymentReview, access.bank],
  );
  const bankLoader = useMemo(
    () => () => (access.bank ? loadBankMatchingSummary() : Promise.resolve(null)),
    [access.bank],
  );
  const sales = useLoad(salesLoader);
  const pending = useLoad(pendingLoader);
  const bank = useLoad(bankLoader);

  const salesResult = sales.state.status === "ready" ? sales.state.data : null;
  const salesData = salesResult?.data ?? null;
  const failedPeriods = salesResult?.failed ?? [];
  const pendingData = pending.state.status === "ready" ? pending.state.data : null;
  const current = salesData?.[period] ?? null;

  const showAttention = access.sales || access.paymentReview || access.bank;
  const hasMain = access.sales || access.bank;
  const salesFailed = access.sales && sales.state.status === "error";
  // One period failing leaves the other panels intact; only the sub-panel
  // that needs the missing period says so (never a zero).
  const periodFailed = failedPeriods.includes(period);
  // Whole failure (every requested queue source) or a single source that failed.
  const pendingFailed = pending.state.status === "error";
  const pendingPartial = (pendingData?.failed.length ?? 0) > 0;
  const attentionLoading =
    pending.state.status === "loading" || (access.sales && sales.state.status === "loading");
  // One source failing never hides the queues the other one loaded.
  const attentionFailed = pendingFailed && (!access.sales || salesFailed);
  // Follow-up queues are not period-bound, so any period's figures serve.
  const queues = buildAttentionQueues(anyPeriodKpis(salesData), pendingData);
  const retryAttention = () => {
    if (pendingFailed || pendingPartial) void pending.retry();
    if (salesFailed) void sales.retry();
  };

  if (!showAttention) {
    return (
      <PageWorkspace
        title={t("dashboard.welcomeTitle")}
        description={t("dashboard.welcomeSubtitle")}
      >
        <div className="max-w-2xl">
          <DashboardShortcuts />
        </div>
      </PageWorkspace>
    );
  }

  const periodSwitch = access.sales ? (
    <ToggleGroup
      type="single"
      value={period}
      aria-label={t("docUi.dashboard.period")}
      onValueChange={(value) => {
        if (value) setPeriod(value as SalesPeriod);
      }}
    >
      {SALES_PERIODS.map((item) => (
        <ToggleGroupItem key={item} value={item} size="default">
          {t(PERIOD_LABEL_KEY[item])}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  ) : undefined;

  const attention = (
    <AttentionPanel
      open={queues.open}
      cleared={queues.cleared}
      loading={attentionLoading}
      failed={attentionFailed}
      partialFailed={!attentionFailed && (pendingFailed || pendingPartial || salesFailed)}
      onRetry={retryAttention}
    />
  );

  const bankSummary =
    bank.state.status === "ready" && bank.state.data
      ? summarizeBankMatching(bank.state.data)
      : null;

  return (
    <PageWorkspace
      title={t("dashboard.welcomeTitle")}
      description={t("dashboard.welcomeSubtitle")}
      actions={periodSwitch}
    >
      {hasMain ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,23rem)]">
          <div className="flex min-w-0 flex-col gap-4 max-lg:contents">
            {access.sales ? (
              <div className="min-w-0 max-lg:order-2">
                {salesFailed || periodFailed ? (
                  <DashboardPanel
                    id="dash-sales"
                    tone="destructive"
                    title={t("docUi.dashboard.salesTitle")}
                  >
                    <ErrorState
                      description={t(
                        salesFailed ? "docUi.dashboard.loadFailed" : "docUi.dashboard.periodFailed",
                      )}
                      onRetry={() => void sales.retry()}
                    />
                  </DashboardPanel>
                ) : (
                  <SalesOverviewPanel
                    data={current}
                    period={period}
                    leadsHref={access.leads ? "/crm/leads" : undefined}
                    ordersHref={access.orders ? "/store-orders" : undefined}
                  />
                )}
              </div>
            ) : null}
            {access.sales && !salesFailed ? (
              <div className="min-w-0 max-lg:order-3">
                <ActivityPanel
                  data={salesData}
                  partial={failedPeriods.length > 0}
                  onRetry={() => void sales.retry()}
                />
              </div>
            ) : null}
            {access.bank ? (
              <div className="min-w-0 max-lg:order-4">
                <BankMatchingPanel
                  summary={bankSummary}
                  loading={bank.state.status === "loading"}
                  failed={bank.state.status === "error"}
                  onRetry={() => void bank.retry()}
                />
              </div>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col gap-4 max-lg:contents">
            <div className="min-w-0 max-lg:order-1">{attention}</div>
            {current && current.scope !== "OWN" ? (
              <div className="min-w-0 max-lg:order-5">
                <RankingPanel data={current} period={period} />
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="max-w-2xl">{attention}</div>
      )}
    </PageWorkspace>
  );
}
