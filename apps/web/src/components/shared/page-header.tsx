import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Page heading (design-system §11.2): title + optional one-line subtitle,
 * then an optional quiet `meta` group, then the actions at the logical end —
 * one compact row, `items-center`.
 *
 * - The subtitle stacks under the title below lg and sits inline, truncated,
 *   on lg+ — so on desktop the whole header is one control-height row. On
 *   phones it stays as ONE truncated line (it can be guidance, e.g. payment
 *   review's «أكّد ورحّل أو ارفض…»), with the full text in `title`.
 * - `meta` (small labeled chips: list KPIs, status counters) is rendered only
 *   when provided. It shares the row when there is room and wraps to its own
 *   quiet line when there is not; it never pushes the actions off-screen.
 * - `actions` is normally `<HeaderActions />` (one primary, ≤2 secondary,
 *   «المزيد» overflow).
 *
 * Filters deliberately have no slot here. They belong to the workspace that
 * owns them — `ListToolbar` at the top of the list card — so that clearing a
 * filter visibly affects the surface it sits on, and so a page never grows a
 * second, differently-styled control strip floating under the title.
 */
/**
 * One quiet labeled counter for `PageHeader` `meta` ("Unmatched 12"). The
 * label always names the figure; the value is tabular. Replaces a row of
 * full KPI cards when the numbers are context, not the page's content.
 */
export function PageHeaderStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "warning" | "destructive";
}) {
  return (
    <span
      data-slot="page-header-stat"
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-xs border px-2 text-caption",
        tone === "neutral" && "border-border bg-card",
        tone === "warning" && "border-warning-border bg-warning-soft",
        tone === "destructive" && "border-destructive-border bg-destructive-soft",
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="num font-semibold text-foreground">{value ?? "—"}</span>
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  meta,
  className,
  dense,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Quiet labeled chips (counters, status groups) — rendered only when provided. */
  meta?: ReactNode;
  className?: string;
  /** Table/list workspaces only (see `PageWorkspace`) — tighter wrap-gap. Never set on dashboards, detail pages, or forms. */
  dense?: boolean;
}) {
  return (
    <div
      data-slot="page-header"
      className={cn(
        "flex flex-wrap items-center gap-x-3",
        dense ? "gap-y-1.5" : "gap-y-2",
        className,
      )}
    >
      <div className="flex min-w-48 flex-1 basis-0 flex-col lg:flex-row lg:items-baseline lg:gap-2">
        <h1 className="shrink-0 text-ui-title font-semibold tracking-tight">{title}</h1>
        {subtitle ? (
          <p
            className="min-w-0 truncate text-caption text-muted-foreground sm:overflow-visible sm:whitespace-normal lg:overflow-hidden lg:whitespace-nowrap"
            title={subtitle}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {meta ? (
        <div
          data-slot="page-header-meta"
          className="flex min-w-0 flex-wrap items-center gap-1.5 text-caption text-muted-foreground"
        >
          {meta}
        </div>
      ) : null}
      {actions ? (
        <div className="ms-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
