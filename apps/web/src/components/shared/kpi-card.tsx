import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const toneClasses = {
  green: "bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  gray: "bg-muted text-muted-foreground",
} as const;

/**
 * Top: icon in a soft colored circle. Center: the large number. Bottom:
 * label, with an optional trend/description row — shows "—" when no value
 * is supplied yet, never a fabricated number or trend.
 */
export function KpiCard({
  icon: Icon,
  label,
  value,
  trend,
  description,
  tone = "green",
  className,
}: {
  icon: LucideIcon;
  label: string;
  value?: string | number;
  trend?: { direction: "up" | "down"; label: string };
  description?: string;
  tone?: keyof typeof toneClasses;
  className?: string;
}) {
  return (
    <EnterpriseCard className={cn("h-full", className)}>
      <EnterpriseCardContent className="flex h-full min-h-[168px] flex-col gap-4">
        <div
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full",
            toneClasses[tone],
          )}
        >
          <Icon className="size-5" />
        </div>
        <div className="flex flex-1 flex-col justify-end gap-1">
          <span className="text-display font-semibold tabular-nums tracking-tight">
            {value ?? "—"}
          </span>
          <span className="text-caption text-muted-foreground">{label}</span>
          {(trend ?? description) && (
            <div className="mt-1 flex items-center gap-2 text-caption">
              {trend && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 font-medium",
                    trend.direction === "up" ? "text-success" : "text-destructive",
                  )}
                >
                  {trend.direction === "up" ? (
                    <ArrowUp className="size-3" />
                  ) : (
                    <ArrowDown className="size-3" />
                  )}
                  {trend.label}
                </span>
              )}
              {description && <span className="text-muted-foreground">{description}</span>}
            </div>
          )}
        </div>
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}
