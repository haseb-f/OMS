import type { ReactNode } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";

/**
 * Canonical internal-screen architecture:
 * Header (title / description / primary actions)
 * → Main workspace (table, form, operational content)
 * → Secondary (metrics, activity, supporting panels)
 *
 * Filters belong with the workspace that owns them (e.g. the table card),
 * not as a floating strip under the title. Breadcrumbs live in the shell.
 */
export function PageWorkspace({
  title,
  description,
  actions,
  filters,
  children,
  secondary,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Prefer `filterBar` on EnterpriseDataTable. Use this only when the page has no table. */
  filters?: ReactNode;
  children?: ReactNode;
  secondary?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <PageHeader title={title} subtitle={description} actions={actions} filters={filters} />
      {children ? <div className="min-w-0">{children}</div> : null}
      {secondary ? <aside className="min-w-0">{secondary}</aside> : null}
    </div>
  );
}
