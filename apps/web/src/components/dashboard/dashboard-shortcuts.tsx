"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Bookmark } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { navigationConfig } from "@/navigation/navigation.config";
import { usePinnedItems } from "@/hooks/use-pinned-items";
import { useRecentPages } from "@/hooks/use-recent-pages";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";

/** No figures apply to this role: a concise empty state with the user's own shortcuts. */
export function DashboardShortcuts() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const { pinnedIds } = usePinnedItems();
  const recentIds = useRecentPages();

  const shortcuts = useMemo(() => {
    const byId = new Map(navigationConfig.map((item) => [item.id, item]));
    const seen = new Set<string>();
    return [...pinnedIds, ...recentIds]
      .map((id) => byId.get(id))
      .filter((item): item is NonNullable<typeof item> => {
        if (!item?.route || item.route === "/" || seen.has(item.id)) return false;
        seen.add(item.id);
        return (item.permissions ?? []).every(hasPermission);
      })
      .slice(0, 8);
  }, [pinnedIds, recentIds, hasPermission]);

  return (
    <DashboardPanel id="dash-shortcuts" icon={Bookmark} title={t("docUi.dashboard.shortcuts")}>
      <EmptyState
        title={t("docUi.dashboard.emptyTitle")}
        description={t("docUi.dashboard.emptyDescription")}
        className="py-6"
      />
      <div className="border-t border-border px-3 py-3">
        {shortcuts.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {shortcuts.map((item) => (
              <li key={item.id}>
                <EnterpriseButton asChild variant="outline" size="sm">
                  <Link href={item.route!}>{t(item.titleKey)}</Link>
                </EnterpriseButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-caption text-muted-foreground">{t("docUi.dashboard.noShortcuts")}</p>
        )}
      </div>
    </DashboardPanel>
  );
}
