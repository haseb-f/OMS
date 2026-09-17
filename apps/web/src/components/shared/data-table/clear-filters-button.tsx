"use client";

import { FilterX } from "lucide-react";

import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseBadge } from "@/components/ui/badge";
import { useLocale } from "@/providers/locale-provider";

/**
 * The ONE reset control for a list's filter bar. Renders nothing while
 * nothing is filtered, and carries the count of active filters so the user
 * can tell at a glance that a narrow result set is their own doing and not an
 * empty table — every list used to hand-roll this as a bare conditional
 * button with no count.
 *
 * `activeCount` is the number of *filters* engaged, not values chosen: a
 * status filter holding three statuses is one active filter.
 */
export function ClearFiltersButton({
  activeCount,
  onClear,
}: {
  activeCount: number;
  onClear: () => void;
}) {
  const { t } = useLocale();

  if (activeCount <= 0) return null;

  return (
    <EnterpriseButton type="button" variant="ghost" size="sm" onClick={onClear}>
      <FilterX data-icon="inline-start" />
      {t("table.clearFilters")}
      <EnterpriseBadge variant="secondary" className="h-4 min-w-4 px-1" aria-hidden>
        {activeCount}
      </EnterpriseBadge>
      <span className="sr-only">{t("table.activeFilterCount", { count: activeCount })}</span>
    </EnterpriseButton>
  );
}
