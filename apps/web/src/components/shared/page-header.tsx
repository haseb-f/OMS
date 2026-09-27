import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Page heading only: title, optional one-line subtitle, primary actions —
 * on one row (design-system §5). The subtitle is a single caption line
 * (truncated on lg, where the row stays one line); actions wrap under the
 * title only when the row genuinely has no room.
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
  dense,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
  /** Table/list workspaces only (see `PageWorkspace`) — tighter wrap-gap when actions drop to their own line. Never set on dashboards, detail pages, or forms. */
  dense?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between",
        dense ? "gap-2" : "gap-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 basis-60 flex-col justify-center">
        <h1 className="text-ui-title font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="text-caption text-muted-foreground lg:truncate" title={subtitle}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
