import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import {
  EnterpriseCard,
  EnterpriseCardAction,
  EnterpriseCardDescription,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { EnterpriseButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * One dashboard panel: a shared card with a compact header row (icon, title,
 * optional status badge, one-line context, one action at the end) and a body.
 * Every home-dashboard section uses it, so headers, radii and spacing match.
 */
export function DashboardPanel({
  id,
  title,
  description,
  icon: Icon,
  badge,
  action,
  children,
  className,
  busy,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  busy?: boolean;
}) {
  return (
    <EnterpriseCard
      size="sm"
      surface="soft"
      role="region"
      aria-labelledby={id}
      aria-busy={busy || undefined}
      className={cn("min-w-0 gap-0 py-0", className)}
    >
      <EnterpriseCardHeader className="gap-0.5 border-b py-3">
        <EnterpriseCardTitle className="flex min-w-0 items-center gap-2 font-semibold">
          {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
          <h2 id={id} className="truncate">
            {title}
          </h2>
          {badge}
        </EnterpriseCardTitle>
        {description ? (
          <EnterpriseCardDescription className="truncate">{description}</EnterpriseCardDescription>
        ) : null}
        {action ? (
          <EnterpriseCardAction className="self-center">{action}</EnterpriseCardAction>
        ) : null}
      </EnterpriseCardHeader>
      <div className="min-w-0">{children}</div>
    </EnterpriseCard>
  );
}

/** The header's drill-down link (a quiet ghost button with a direction-aware chevron). */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <EnterpriseButton asChild variant="ghost" size="xs" className="text-muted-foreground">
      <Link href={href}>
        {children}
        <ChevronRight className="rtl:rotate-180" aria-hidden />
      </Link>
    </EnterpriseButton>
  );
}

/** Loading rows for a panel body — the shape of a list, never a spinner. */
export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col divide-y divide-border">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-8 shrink-0" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-5 w-8" />
        </div>
      ))}
    </div>
  );
}

/** A thin, labelled proportion track (real value only; tokens for both fills). */
export function ShareBar({
  value,
  label,
  tone = "chart",
}: {
  value: number;
  label: string;
  tone?: "chart" | "success";
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="img"
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          "h-full rounded-full",
          tone === "success" ? "bg-success-soft-foreground" : "bg-chart-2",
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
