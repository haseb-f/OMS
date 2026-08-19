import type { ReactNode } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";

/**
 * Canonical internal-screen architecture:
 * Header (title / description / primary actions)
 * → Main workspace (table, form, operational content)
 * → Secondary (metrics, activity, supporting panels)
 *
 * Filters belong to the workspace that owns them — `filterBar` on
 * `EnterpriseDataTable`, or `ListToolbar` for the few lists that cannot be a
 * flat table. Breadcrumbs and Back live in the shell.
 */
export function PageWorkspace({
  title,
  description,
  actions,
  children,
  secondary,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
  secondary?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <PageHeader title={title} subtitle={description} actions={actions} />
      {children ? <div className="min-w-0">{children}</div> : null}
      {secondary ? <aside className="min-w-0">{secondary}</aside> : null}
    </div>
  );
}
