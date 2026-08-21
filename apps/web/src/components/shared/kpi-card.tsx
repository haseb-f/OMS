import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const toneClasses = {
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning-foreground",
  destructive: "bg-destructive-soft text-destructive",
  muted: "bg-muted text-muted-foreground",
  /** @deprecated Use `success` */
  green: "bg-success-soft text-success",
  /** @deprecated Use `info` */
  blue: "bg-info-soft text-info",
  /** @deprecated Use `muted` */
  gray: "bg-muted text-muted-foreground",
} as const;

/**
 * Compact operational metric tile — token-driven tones, no decorative hero sizing.
 */
export function KpiCard({
  icon: Icon,
  label,
  value,
  trend,
  description,
  tone = "primary",
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
    <EnterpriseCard size="sm" className={cn("h-full", className)}>
      <EnterpriseCardContent className="flex h-full flex-col gap-1.5">
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md",
            toneClasses[tone],
          )}
        >
          <Icon className="size-3.5" />
        </div>
        <div className="flex flex-1 flex-col justify-end gap-0.5">
          <span className="text-ui-title font-semibold tabular-nums tracking-tight">
            {value ?? "—"}
          </span>
          <span className="text-caption text-muted-foreground">{label}</span>
          {(trend ?? description) && (
            <div className="mt-0.5 flex items-center gap-2 text-caption">
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
