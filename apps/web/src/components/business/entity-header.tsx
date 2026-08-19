import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The standard header for any record detail page (a customer, an order, an
 * invoice, …): icon/avatar, title, subtitle, a status slot, and an actions
 * slot. No page should hand-build its own version of this layout.
 */
export function EntityHeader({
  icon: Icon,
  title,
  subtitle,
  status,
  actions,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
            <Icon className="size-5" />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-card-title">{title}</h2>
            {status}
          </div>
          {subtitle && <p className="text-body text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
