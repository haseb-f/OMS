"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { EnterpriseButton } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { navigationConfig } from "@/navigation/navigation.config";
import { usePinnedItems } from "@/hooks/use-pinned-items";
import { useRecentPages } from "@/hooks/use-recent-pages";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import type { SalesPeriod } from "@/services/sales-performance-service";
import { DashboardOverview } from "@/components/dashboard/dashboard-overview";

/**
 * Role-relevant home: every tile is a real figure from an existing endpoint
 * the user can access, and links to the list behind it (with the same filter
 * when that list supports one). Users with nothing to show get their
 * shortcuts instead of decorative counts or permanently empty cards.
 */
export default function DashboardPage() {
  const { hasPermission } = useUserContext();
  const showSales = hasPermission("crm.leads.view") || hasPermission("store-orders.view");
  const showPaymentReview = hasPermission("sales.receipts.view");
  const showBank = hasPermission("accounting.bank-transactions.view");
  const [period, setPeriod] = useState<SalesPeriod>("month");

  return (
    <DashboardOverview
      showSales={showSales}
      showPaymentReview={showPaymentReview}
      showBank={showBank}
      period={period}
      onPeriodChange={setPeriod}
      emptyState={<ShortcutsEmptyState />}
    />
  );
}

/** No figures apply to this role: a concise empty state with the user's own shortcuts. */
function ShortcutsEmptyState() {
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
    <EnterpriseCard size="sm">
      <EnterpriseCardContent className="flex flex-col gap-3">
        <EmptyState
          title={t("docUi.dashboard.emptyTitle")}
          description={t("docUi.dashboard.emptyDescription")}
        />
        <div className="flex flex-col gap-2">
          <h2 className="text-caption font-medium text-muted-foreground">
            {t("docUi.dashboard.shortcuts")}
          </h2>
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
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}
