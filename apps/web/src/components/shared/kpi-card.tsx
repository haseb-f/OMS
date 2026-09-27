import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tone is an accent only: it colors the icon (and nothing else). Status is
 * never carried by the tile's color — the label names what is counted.
 */
const toneIconClasses = {
  primary: "text-primary",
  success: "text-success-soft-foreground",
  info: "text-info-soft-foreground",
  warning: "text-warning-soft-foreground",
  destructive: "text-destructive-soft-foreground",
  muted: "text-muted-foreground",
  /** @deprecated Use `success` */
  green: "text-success-soft-foreground",
  /** @deprecated Use `info` */
  blue: "text-info-soft-foreground",
  /** @deprecated Use `muted` */
  gray: "text-muted-foreground",
} as const;

export type KpiTone = keyof typeof toneIconClasses;

/**
 * The one metric tile (design-system §5 "Metric tile"). Every tile shows a
 * real figure; when a list exists behind the figure, `href` turns the tile
 * into a link to that list with the same filter. `compact` is for dense
 * strips (dashboards, detail headers); `default` for summary rows.
 */
export function KpiCard({
  icon: Icon,
  label,
  value,
  trend,
  description,
  tone = "primary",
  size = "default",
  href,
  isLoading,
  className,
}: {
  icon?: LucideIcon;
  label: string;
  value?: ReactNode;
  trend?: { direction: "up" | "down"; label: string };
  description?: ReactNode;
  tone?: KpiTone;
  size?: "default" | "compact";
  /** Drill-down list for this figure (same filter). */
  href?: string;
  isLoading?: boolean;
  className?: string;
}) {
  const compact = size === "compact";
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 line-clamp-2 text-caption text-muted-foreground" title={label}>
          {label}
        </span>
        {Icon ? (
          <Icon className={cn("size-4 shrink-0", toneIconClasses[tone])} aria-hidden />
        ) : null}
      </div>
      {isLoading ? (
        <span
          className={cn(
            "block w-16 animate-pulse rounded-xs bg-muted motion-reduce:animate-none",
            compact ? "h-5" : "h-6",
          )}
          aria-hidden
        />
      ) : (
        <span
          className={cn(
            "block truncate text-start text-foreground",
            compact ? "text-card-title font-semibold" : "text-metric",
          )}
        >
          <span className="num">{value ?? "—"}</span>
        </span>
      )}
      {trend || description || href ? (
        <div className="flex min-w-0 items-center gap-2 text-caption">
          {trend ? (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-0.5 font-medium",
                trend.direction === "up"
                  ? "text-success-soft-foreground"
                  : "text-destructive-soft-foreground",
              )}
            >
              {trend.direction === "up" ? (
                <ArrowUp className="size-3" aria-hidden />
              ) : (
                <ArrowDown className="size-3" aria-hidden />
              )}
              {trend.label}
            </span>
          ) : null}
          {description ? (
            <span className="min-w-0 truncate text-muted-foreground">{description}</span>
          ) : null}
          {href ? (
            <ChevronRight
              className="ms-auto size-3.5 shrink-0 text-muted-foreground rtl:rotate-180"
              aria-hidden
            />
          ) : null}
        </div>
      ) : null}
    </>
  );

  const surface = cn(
    "flex h-full min-w-0 flex-col rounded-md border border-border bg-card text-card-foreground",
    compact ? "gap-0.5 px-3 py-2" : "gap-1 p-3",
    className,
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          surface,
          "transition-colors duration-(--duration-base) ease-(--ease-standard) hover:border-border-strong hover:bg-table-row-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
        )}
      >
        {body}
      </Link>
    );
  }

  return <div className={surface}>{body}</div>;
}
