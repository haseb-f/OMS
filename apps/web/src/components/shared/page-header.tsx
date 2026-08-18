import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Page heading only: title, optional subtitle, primary actions.
 * Filters belong with the workspace that owns them (table card, report bar),
 * not as a floating strip under the title — see `PageWorkspace`.
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
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col justify-center gap-0.5">
          <h1 className="text-ui-title font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-caption text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
    </div>
  );
}
