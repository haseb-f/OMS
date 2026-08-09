import type { LucideIcon } from "lucide-react";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";

export interface QuickStat {
  label: string;
  value: string | number;
  icon?: LucideIcon;
}

/**
 * A compact strip of small stats inside one card — for an entity detail
 * page's header area (e.g. "Orders · Lifetime Value · Last Order"),
 * distinct from the dashboard's large standalone `KpiCard`.
 */
export function QuickStatsCard({ stats, className }: { stats: QuickStat[]; className?: string }) {
  return (
    <EnterpriseCard className={className}>
      <EnterpriseCardContent className="flex items-stretch divide-x divide-border rtl:divide-x-reverse">
        {stats.map((stat, index) => (
          <div key={index} className="flex flex-1 items-center gap-2.5 px-4 first:ps-0 last:pe-0">
            {stat.icon && (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <stat.icon className="size-4" />
              </span>
            )}
            <div className="flex flex-col">
              <span className="text-card-title font-semibold tabular-nums">{stat.value}</span>
              <span className="text-caption text-muted-foreground">{stat.label}</span>
            </div>
          </div>
        ))}
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}
