import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Every page follows the same sequence: Title → Subtitle → Primary Actions →
 * Filters → Content (rendered by the page itself) → Pagination. This
 * component owns the first four; never build a one-off page heading layout.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  filters,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  filters?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-page-title font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-body text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
    </div>
  );
}
