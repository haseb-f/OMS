"use client";

import Link from "next/link";
import { Bell, Boxes, Bookmark, Clock, Globe, Layers, Pin, Zap } from "lucide-react";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/shared/kpi-card";
import { navigationConfig } from "@/navigation/navigation.config";
import { flattenNavigationTree, buildNavigationTree } from "@/navigation/build-navigation-tree";
import { iconRegistry } from "@/navigation/icon-registry";
import { usePinnedItems } from "@/hooks/use-pinned-items";
import { useRecentPages } from "@/hooks/use-recent-pages";
import { useLocale } from "@/providers/locale-provider";
import { locales } from "@/i18n/locales";

const flatNavigation = flattenNavigationTree(buildNavigationTree(navigationConfig));
const moduleCount = navigationConfig.filter((item) => !item.parent).length;

/**
 * The shell's landing page. Every metric shown here is real (derived from
 * this frontend's own configuration/state), never fabricated business
 * data — no backend module reports numbers to this page yet.
 */
export default function DashboardPage() {
  const { t } = useLocale();
  const { pinnedIds } = usePinnedItems();
  const recentIds = useRecentPages();

  const pinnedItems = flatNavigation.filter((item) => pinnedIds.includes(item.id));

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
              title={t("topbar.notificationsEmptyTitle")}
              description={t("topbar.notificationsEmptyDescription")}
            />
          </EnterpriseCardContent>
        </EnterpriseCard>

        <EnterpriseCard className="lg:col-span-2">
          <EnterpriseCardHeader>
            <EnterpriseCardTitle>{t("dashboard.pinnedModulesTitle")}</EnterpriseCardTitle>
          </EnterpriseCardHeader>
          <EnterpriseCardContent>
            {pinnedItems.length === 0 ? (
              <EmptyState
                icon={Bookmark}
                title={t("dashboard.pinnedModulesEmptyTitle")}
                description={t("dashboard.pinnedModulesEmptyDescription")}
              />
            ) : (
              <ul className="flex flex-col gap-1">
                {pinnedItems.map((item) => {
                  const Icon = item.icon ? iconRegistry[item.icon] : Bookmark;
                  return (
                    <li key={item.id}>
                      <Link
                        href={item.route ?? "#"}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                      >
                        <Icon className="size-4 text-muted-foreground" />
                        <span>{t(item.titleKey)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </EnterpriseCardContent>
        </EnterpriseCard>
      </div>
    </PageWorkspace>
  );
}
