"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Boxes,
  Clock,
  Globe,
  Layers,
  Pin,
  Zap,
  Contact,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/shared/kpi-card";
import { EnterpriseButton } from "@/components/ui/button";
import { navigationConfig } from "@/navigation/navigation.config";
import { usePinnedItems } from "@/hooks/use-pinned-items";
import { useRecentPages } from "@/hooks/use-recent-pages";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { locales } from "@/i18n/locales";
import {
  salesPerformanceService,
  type SalesPeriod,
  type SalesPerformanceDashboard,
} from "@/services/sales-performance-service";

const moduleCount = navigationConfig.filter((item) => !item.parent).length;

export default function DashboardPage() {
  const { hasPermission } = useUserContext();
  const showSales = hasPermission("crm.leads.view") || hasPermission("store-orders.view");

  if (showSales) {
    return <SalesDashboard />;
  }

  return <WorkspaceHome />;
}

function SalesDashboard() {
  const { t } = useLocale();
  const [period, setPeriod] = useState<SalesPeriod>("month");
  const [data, setData] = useState<SalesPerformanceDashboard | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await salesPerformanceService.dashboard(period));
    } catch {
      setData(null);
    }
  }, [period]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const kpis = data?.kpis;
  const rank = data?.ranking.self;

  return (
    <PageWorkspace title={t("dashboard.welcomeTitle")} description={t("dashboard.welcomeSubtitle")}>
      <div className="flex flex-wrap gap-2">
        {(["today", "week", "month"] as const).map((item) => (
          <EnterpriseButton
            key={item}
            size="sm"
            variant={period === item ? "default" : "outline"}
            onClick={() => setPeriod(item)}
          >
            {t(
              item === "today"
                ? "crm.leads.dashboard.today"
                : item === "week"
                  ? "crm.leads.dashboard.week"
                  : "crm.leads.dashboard.month",
            )}
          </EnterpriseButton>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={Contact}
          label={t("crm.leads.dashboard.newLeads")}
          value={kpis?.newLeads ?? "—"}
          tone="info"
        />
        <KpiCard
          icon={Clock}
          label={t("crm.leads.dashboard.inProgress")}
          value={kpis?.inProgress ?? "—"}
          tone="primary"
        />
        <KpiCard
          icon={Bell}
          label={t("crm.leads.dashboard.dueToday")}
          value={kpis?.dueToday ?? "—"}
          tone="warning"
        />
        <KpiCard
          icon={Bell}
          label={t("crm.leads.dashboard.overdue")}
          value={kpis?.overdue ?? "—"}
          tone="destructive"
        />
        <KpiCard
          icon={TrendingUp}
          label={t("crm.leads.dashboard.converted")}
          value={kpis?.converted ?? "—"}
          tone="success"
        />
        <KpiCard
          icon={ShoppingBag}
          label={t("crm.leads.dashboard.orders")}
          value={kpis?.orders ?? "—"}
          tone="primary"
        />
        <KpiCard
          icon={Boxes}
          label={t("crm.leads.dashboard.delivered")}
          value={kpis?.delivered ?? "—"}
          tone="success"
        />
        <KpiCard
          icon={TrendingUp}
          label={t("crm.leads.dashboard.conversionRate")}
          value={kpis ? `${kpis.conversionRate}%` : "—"}
          tone="info"
        />
      </div>
      {rank ? (
        <EnterpriseCard>
          <EnterpriseCardHeader>
            <EnterpriseCardTitle>{t("crm.leads.dashboard.ranking")}</EnterpriseCardTitle>
          </EnterpriseCardHeader>
          <EnterpriseCardContent>
            <p className="text-ui-title font-medium">
              #{rank.rank} {t("crm.leads.dashboard.of")} {rank.of}
            </p>
            <p className="text-caption text-muted-foreground">
              {rank.orders} {t("crm.leads.dashboard.orders")}
            </p>
            {data?.ranking.leaderboard.length ? (
              <div className="mt-3 flex flex-col gap-1">
                {data.ranking.leaderboard.slice(0, 8).map((row) => (
                  <p key={`${row.rank}-${row.userId}`} className="text-caption">
                    #{row.rank} {row.displayName} — {row.orders}
                  </p>
                ))}
              </div>
            ) : null}
          </EnterpriseCardContent>
        </EnterpriseCard>
      ) : null}
    </PageWorkspace>
  );
}

function WorkspaceHome() {
  const { t } = useLocale();
  const { pinnedIds } = usePinnedItems();
  const recentIds = useRecentPages();

  return (
    <PageWorkspace title={t("dashboard.welcomeTitle")} description={t("dashboard.welcomeSubtitle")}>
      <div aria-label={t("dashboard.kpiTitle")} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={Layers} label={t("nav.dashboard")} value={moduleCount} tone="primary" />
        <KpiCard icon={Pin} label={t("sidebar.pinned")} value={pinnedIds.length} tone="info" />
        <KpiCard icon={Clock} label={t("sidebar.recent")} value={recentIds.length} tone="muted" />
        <KpiCard
          icon={Globe}
          label={t("topbar.changeLanguage")}
          value={locales.length}
          tone="info"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <EnterpriseCard className="lg:col-span-2">
          <EnterpriseCardHeader>
            <EnterpriseCardTitle>{t("dashboard.recentActivityTitle")}</EnterpriseCardTitle>
          </EnterpriseCardHeader>
          <EnterpriseCardContent>
            <EmptyState
              icon={Boxes}
              title={t("dashboard.recentActivityEmptyTitle")}
              description={t("dashboard.recentActivityEmptyDescription")}
            />
          </EnterpriseCardContent>
        </EnterpriseCard>

        <EnterpriseCard>
          <EnterpriseCardHeader>
            <EnterpriseCardTitle>{t("dashboard.quickActionsTitle")}</EnterpriseCardTitle>
          </EnterpriseCardHeader>
          <EnterpriseCardContent>
            <EmptyState
              icon={Zap}
              title={t("topbar.quickActionsEmptyTitle")}
              description={t("topbar.quickActionsEmptyDescription")}
            />
          </EnterpriseCardContent>
        </EnterpriseCard>

        <EnterpriseCard>
          <EnterpriseCardHeader>
            <EnterpriseCardTitle>{t("topbar.notifications")}</EnterpriseCardTitle>
          </EnterpriseCardHeader>
          <EnterpriseCardContent>
            <EmptyState
              icon={Bell}
              title={t("topbar.notifications")}
              description={t("dashboard.recentActivityEmptyDescription")}
            />
          </EnterpriseCardContent>
        </EnterpriseCard>
      </div>
    </PageWorkspace>
  );
}
