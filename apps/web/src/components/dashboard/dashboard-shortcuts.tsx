"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Bookmark } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { buildLandingShortcuts } from "@/components/dashboard/landing-shortcuts";
import { navigationConfig } from "@/navigation/navigation.config";
import { usePinnedItems } from "@/hooks/use-pinned-items";
import { useRecentPages } from "@/hooks/use-recent-pages";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";

/**
 * No figures apply to this role: a concise empty state whose next actions are
 * the user's own pinned / recent pages or, when there are none, the first page
 * of every module they may open — never a dead end.
 */
export function DashboardShortcuts() {
  const { t } = useLocale();
  const { permissions, isSuperAdmin } = useUserContext();
  const { pinnedIds } = usePinnedItems();
  const recentIds = useRecentPages();

  const { personal, suggested } = useMemo(
    () =>
      buildLandingShortcuts({
        navigation: navigationConfig,
        permissions,
        isSuperAdmin,
        pinnedIds,
        recentIds,
      }),
    [permissions, isSuperAdmin, pinnedIds, recentIds],
  );
  const shortcuts = personal.length > 0 ? personal : suggested;

  return (
    <DashboardPanel
      id="dash-shortcuts"
      icon={Bookmark}
      tone="info"
      title={t(personal.length > 0 ? "docUi.dashboard.shortcuts" : "docUi.dashboard.suggested")}
    >
      <EmptyState
        title={t("docUi.dashboard.emptyTitle")}
        description={t(
          shortcuts.length > 0 ? "docUi.dashboard.emptyDescription" : "docUi.dashboard.noShortcuts",
        )}
        className="py-6"
      />
      {shortcuts.length > 0 ? (
        <div className="border-t border-border px-3 py-3">
          <ul className="flex flex-wrap gap-2">
            {shortcuts.map((item) => (
              <li key={item.id}>
                <EnterpriseButton asChild variant="outline" size="sm">
                  <Link href={item.route!}>{t(item.titleKey)}</Link>
                </EnterpriseButton>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </DashboardPanel>
  );
}
