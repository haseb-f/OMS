"use client";

import { useLocale } from "@/providers/locale-provider";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { DashboardPanel, PanelSkeleton } from "@/components/dashboard/dashboard-panel";

/** Permissions not known yet: the panels' own shape as skeletons, never an empty state. */
export function DashboardLoading() {
  const { t } = useLocale();
  return (
    <PageWorkspace title={t("dashboard.welcomeTitle")} description={t("dashboard.welcomeSubtitle")}>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,23rem)]">
        <DashboardPanel id="dash-loading-main" title="…" busy>
          <PanelSkeleton rows={4} />
        </DashboardPanel>
        <DashboardPanel id="dash-loading-side" title="…" busy>
          <PanelSkeleton rows={3} />
        </DashboardPanel>
      </div>
    </PageWorkspace>
  );
}
