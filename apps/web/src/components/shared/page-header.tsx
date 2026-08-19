import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Page heading only: title, optional subtitle, primary actions.
 *
 * Filters deliberately have no slot here. They belong to the workspace that
 * owns them — `ListToolbar` at the top of the list card — so that clearing a
 * filter visibly affects the surface it sits on, and so a page never grows a
 * second, differently-styled control strip floating under the title.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 flex-col justify-center gap-0.5">
        <h1 className="text-ui-title font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-caption text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
