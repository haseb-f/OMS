import type { ReactNode } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { ViewportFillProvider } from "@/components/shared/data-table/list-surface";
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
 *
 * Viewport fill (design-system §6): a `dense` workspace without `secondary`
 * content marks itself `data-viewport-fill`. On lg+ the shell then locks the
 * page to the viewport and this workspace, its main region and the list
 * inside it flex to the remaining height, so the grid body is the only
 * vertical scroller. The main region itself scrolls as a safety net when a
 * page stacks more around its grid than fits, so nothing is ever clipped.
 * Below lg the page scrolls normally.
 */
export function PageWorkspace({
  title,
  description,
  actions,
  meta,
  children,
  secondary,
  className,
  dense,
  fill,
}: {
  title: string;
  description?: string;
  /** Normally `<HeaderActions />` — one primary, ≤2 secondary, «المزيد» overflow. */
  actions?: ReactNode;
  /** Quiet labeled chips beside/under the title (list KPIs, status counters). */
  meta?: ReactNode;
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
  /** Overrides viewport fill (defaults to `dense && !secondary`). */
  fill?: boolean;
}) {
  const viewportFill = fill ?? (Boolean(dense) && !secondary);
  return (
    <ViewportFillProvider value={viewportFill}>
      <div
        data-viewport-fill={viewportFill ? "" : undefined}
        className={cn(
          "flex flex-col",
          dense ? "gap-2" : "gap-3",
          viewportFill && "lg:min-h-0 lg:flex-1",
          className,
        )}
      >
        <PageHeader
          title={title}
          subtitle={description}
          actions={actions}
          meta={meta}
          dense={dense}
        />
        {children ? (
          <div
            className={cn(
              "min-w-0",
              viewportFill && "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto",
            )}
          >
            {children}
          </div>
        ) : null}
        {secondary ? <aside className="min-w-0">{secondary}</aside> : null}
      </div>
    </ViewportFillProvider>
  );
}
