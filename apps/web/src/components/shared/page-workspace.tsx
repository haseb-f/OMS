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
  dense,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
  secondary?: ReactNode;
  className?: string;
  /**
   * Table/list workspaces only — tightens the header→content gap so the
   * grid starts higher (breadcrumb/title/actions/filters read as one
   * compact workspace header). Every page that renders an
   * `EnterpriseDataTable` (directly, or via `MasterDataPage`) sets this.
   * Never set on dashboards, detail pages, or forms/wizards — they keep
   * the roomier default.
   */
  dense?: boolean;
}) {
  return (
    <div className={cn("flex flex-col", dense ? "gap-2" : "gap-3", className)}>
      <PageHeader title={title} subtitle={description} actions={actions} dense={dense} />
      {children ? <div className="min-w-0">{children}</div> : null}
      {secondary ? <aside className="min-w-0">{secondary}</aside> : null}
    </div>
  );
}
