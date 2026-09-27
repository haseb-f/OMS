"use client";

import type { ReactNode } from "react";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export { BackButton } from "@/components/shared/back-button";

function hasDetailValue(value: ReactNode): boolean {
  if (value == null || value === false) return false;
  if (typeof value === "string" && (value.trim() === "" || value.trim() === "—")) return false;
  return true;
}

/**
 * Compact operational detail workspace — identity header + centered content.
 * Lists stay full-width via `PageWorkspace`; this is for entity/document
 * detail and edit screens only. Back lives in `BreadcrumbBar`, one control
 * for the whole app, so no screen renders its own.
 *
 * Header (design-system §11.2): title (+ `reference`) as the h1, status,
 * one key meta line, and the actions (normally `<HeaderActions />`) at the
 * logical end — one row, `items-center`.
 */
export function DetailWorkspace({
  title,
  subtitle,
  reference,
  status,
  meta,
  actions,
  children,
  width = "default",
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Record reference / code, shown beside the title inside the h1 (LTR, tabular). */
  reference?: ReactNode;
  status?: ReactNode;
  /** Key meta line (party · date · currency) — replaces `subtitle` when both are given. */
  meta?: ReactNode;
  /** Normally `<HeaderActions />`. */
  actions?: ReactNode;
  children?: ReactNode;
  /** `default` for party/order profiles; `wide` for document editors with line grids. */
  width?: "default" | "wide";
  className?: string;
}) {
  const line = hasDetailValue(meta) ? meta : subtitle;
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-2",
        width === "wide" ? "max-w-6xl" : "max-w-[1100px]",
        className,
      )}
    >
      <div
        data-slot="record-header"
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
      >
        <div className="flex min-w-48 flex-1 basis-0 flex-wrap items-center gap-x-2 gap-y-1">
          <div className="min-w-0">
            <h1
              className="flex flex-wrap items-baseline gap-x-2 text-ui-title font-semibold tracking-tight"
              dir="auto"
            >
              <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
              {hasDetailValue(reference) ? (
                <span dir="ltr" className="num text-body font-medium text-muted-foreground">
                  {reference}
                </span>
              ) : null}
            </h1>
            {hasDetailValue(line) ? (
              <p className="text-caption text-muted-foreground">{line}</p>
            ) : null}
          </div>
          {status}
        </div>
        {actions ? (
          <div className="ms-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** Wide centered shell for document editors. Back lives in `BreadcrumbBar`. */
export function EditorWorkspace({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto flex w-full max-w-6xl flex-col gap-2", className)}>{children}</div>
  );
}

/**
 * Identity + toolbar row for a document editor, sitting at the top of the
 * editor card. Every editor (sales, purchasing, financial transactions,
 * journal entries) shows the same things — what the document is, its
 * number, its state, key meta (party · date · currency) and its actions — so
 * they share one row rather than four copies that drift apart.
 * `documentNumber` is forced LTR: document codes stay left-to-right even in
 * the Arabic interface.
 *
 * `sticky` (document pages only, design-system §11.2): the row pins under
 * the top bar on lg+ at ≤64px; phones never pin it.
 */
export function EditorHeader({
  title,
  documentNumber,
  status,
  meta,
  actions,
  sticky = false,
  className,
}: {
  title: ReactNode;
  documentNumber?: ReactNode;
  /** Status badge, or labeled status groups. */
  status?: ReactNode;
  /** Key meta line: party · date · currency. When set, the number moves into the h1. */
  meta?: ReactNode;
  /** Normally `<HeaderActions />`; any node keeps working. */
  actions?: ReactNode;
  sticky?: boolean;
  className?: string;
}) {
  const hasNumber = hasDetailValue(documentNumber);
  const hasMeta = hasDetailValue(meta);
  return (
    <div
      data-slot="record-header"
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border pb-3",
        sticky &&
          "bg-card lg:sticky lg:top-(--shell-topbar-height) lg:z-(--z-sticky) lg:max-h-16 lg:flex-nowrap lg:py-2",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h1 className={cn("text-ui-title font-semibold tracking-tight", sticky && "lg:truncate")}>
            {title}
            {hasNumber && hasMeta ? (
              // The margin lives on a wrapper in the PAGE direction: on the
              // dir="ltr" number itself `ms-2` would land on the wrong side in RTL.
              <span className="ms-2">
                <span dir="ltr" className="num text-body font-medium text-muted-foreground">
                  {documentNumber}
                </span>
              </span>
            ) : null}
          </h1>
          {hasMeta ? (
            <p className="truncate text-caption text-muted-foreground">{meta}</p>
          ) : hasNumber ? (
            <p dir="ltr" className="num truncate text-caption text-muted-foreground">
              {documentNumber}
            </p>
          ) : null}
        </div>
        {status}
      </div>
      {actions ? (
        <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** Compact card section. Omit `title` when the header already names the content. */
export function DetailSection({
  title,
  actions,
  children,
  className,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <EnterpriseCard size="sm" className={className}>
      {title || actions ? (
        <EnterpriseCardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border/70 pb-2">
          {title ? <EnterpriseCardTitle>{title}</EnterpriseCardTitle> : <span />}
          {actions}
        </EnterpriseCardHeader>
      ) : null}
      <EnterpriseCardContent className="flex flex-col gap-2">{children}</EnterpriseCardContent>
    </EnterpriseCard>
  );
}

/**
 * Scannable key-facts strip under a detail header — status totals, party,
 * payment/shipping state. Prefer this over a full-height card for a few
 * metrics so the page does not open with empty card chrome.
 */
export function DetailSummaryBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-x-3 gap-y-2 rounded-md border border-border bg-card p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Labeled field for detail screens (not table cells). Hidden when empty. */
export function DetailField({ label, value }: { label: string; value: ReactNode }) {
  if (!hasDetailValue(value)) return null;
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-body font-medium text-foreground [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}

export function DetailFieldGrid({
  children,
  columns = 2,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2",
        columns === 3 && "lg:grid-cols-3",
        columns === 4 && "lg:grid-cols-4",
      )}
    >
      {children}
    </dl>
  );
}

/**
 * Record header (design-system §11.2): identity (+ reference) as the h1,
 * status, actions — then, under it, the key meta line, labeled status groups
 * (`StatusStrip`) and metrics. Metrics stay in the header so lower sections
 * do not repeat Level-1 facts.
 *
 * Only the identity/actions bar is sticky (lg+, ≤64px, under the top bar);
 * the status groups and metrics scroll away with the page. Phones never pin.
 */
export function RecordHighlightsHeader({
  identity,
  reference,
  status,
  meta,
  statusStrip,
  metrics,
  actions,
  primaryActions,
  moreActions,
  sticky = true,
  className,
}: {
  identity: ReactNode;
  /** Record reference (auto-generated number) — LTR, tabular, inside the h1. */
  reference?: ReactNode;
  status?: ReactNode;
  /** Key meta line: party · date · currency. */
  meta?: ReactNode;
  /** Labeled status facts (`StatusStrip`) — payment and fulfillment stay separate groups. */
  statusStrip?: ReactNode;
  metrics?: ReactNode;
  /** Normally `<HeaderActions />` — takes precedence over `primaryActions`/`moreActions`. */
  actions?: ReactNode;
  /** Legacy slot — prefer `actions={<HeaderActions />}`. */
  primaryActions?: ReactNode;
  /** Legacy slot — prefer `actions={<HeaderActions />}`. */
  moreActions?: ReactNode;
  sticky?: boolean;
  className?: string;
}) {
  const hasMeta = hasDetailValue(meta);
  const hasLower = hasMeta || Boolean(statusStrip) || Boolean(metrics);
  const actionNodes = actions ?? (
    <>
      {primaryActions}
      {moreActions}
    </>
  );
  return (
    // Sticky needs the page column as its containing block, not this header:
    // on lg the wrapper dissolves (`contents`) and the body re-attaches to the
    // bar with a negative margin equal to the page's 8px gap.
    <div className={cn("flex flex-col", sticky && "lg:contents", className)}>
      <div
        data-slot="record-header"
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border border-border bg-card px-3 py-2",
          hasLower ? "rounded-t-md" : "rounded-md",
          sticky &&
            "lg:sticky lg:top-(--shell-topbar-height) lg:z-(--z-sticky) lg:max-h-16 lg:flex-nowrap",
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {/* The record identity is the page's level-1 heading. */}
          <div
            role="heading"
            aria-level={1}
            className="flex min-w-0 items-baseline gap-x-2 text-ui-title font-semibold tracking-tight"
          >
            <span className={cn("min-w-0", sticky && "lg:truncate")}>{identity}</span>
            {hasDetailValue(reference) ? (
              <span dir="ltr" className="num shrink-0 text-body font-medium text-muted-foreground">
                {reference}
              </span>
            ) : null}
          </div>
          {status}
        </div>
        <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {actionNodes}
        </div>
      </div>
      {hasLower ? (
        <div
          className={cn(
            "flex flex-col gap-2 rounded-b-md border border-t-0 border-border bg-card px-3 py-2 [&>[role=group]:first-child]:border-t-0 [&>[role=group]:first-child]:pt-0",
            sticky && "lg:-mt-2",
          )}
        >
          {hasMeta ? <p className="text-caption text-muted-foreground">{meta}</p> : null}
          {statusStrip}
          {metrics ? (
            <div
              className={cn(
                "grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3 lg:grid-cols-5",
                (hasMeta || Boolean(statusStrip)) && "border-t border-border/70 pt-2",
              )}
            >
              {metrics}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Wider main column + compact context sidebar; stacks on tablet/mobile. */
export function DetailSplitLayout({
  main,
  sidebar,
  className,
}: {
  main: ReactNode;
  sidebar: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-2">{main}</div>
      <aside className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-[calc(var(--shell-topbar-height)+0.75rem)] lg:self-start">
        {sidebar}
      </aside>
    </div>
  );
}

/** Compact labelled group — divider rows instead of a card per field. */
export function DetailGroup({
  title,
  actions,
  children,
  className,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-md border border-border bg-card", className)}>
      {title || actions ? (
        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-1.5">
          {title ? (
            <h2 className="text-caption font-semibold tracking-tight">{title}</h2>
          ) : (
            <span />
          )}
          {actions}
        </div>
      ) : null}
      <div className="divide-y divide-border/60 px-3">{children}</div>
    </section>
  );
}

/** One compact horizontal label/value row. Hidden when empty. */
export function DetailFieldRow({
  label,
  value,
  ltr,
}: {
  label: string;
  value: ReactNode;
  ltr?: boolean;
}) {
  if (!hasDetailValue(value)) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <div className="shrink-0 text-caption text-muted-foreground">{label}</div>
      <div
        dir={ltr ? "ltr" : undefined}
        className="min-w-0 text-end text-body font-medium text-foreground [overflow-wrap:anywhere]"
      >
        {value}
      </div>
    </div>
  );
}

export interface StatusStripItem {
  key: string;
  /** Names the fact ("Finance verification", "Shipping") — never left to the badge color. */
  label: string;
  status: ReactNode;
  caption?: ReactNode;
}

/**
 * Labeled status facts for a record header: each item reads "label: badge",
 * and groups (e.g. Payment vs Fulfillment) are visually separated so
 * independent lifecycles are never read as one. Wraps on narrow screens.
 */
export function StatusStrip({
  label,
  groups,
  className,
}: {
  /** Accessible name for the whole strip. */
  label: string;
  groups: { key: string; label?: string; items: StatusStripItem[] }[];
  className?: string;
}) {
  const visible = groups.filter((group) => group.items.length > 0);
  if (visible.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex flex-col gap-2 border-t border-border/70 pt-2 sm:flex-row sm:flex-wrap sm:items-start sm:gap-x-4",
        className,
      )}
    >
      {visible.map((group, index) => (
        <section
          key={group.key}
          aria-label={group.label}
          className={cn(
            "flex min-w-0 flex-col gap-1",
            index > 0 && "border-t border-border/60 pt-2 sm:border-t-0 sm:border-s sm:ps-4 sm:pt-0",
          )}
        >
          {group.label ? <h3 className="text-micro text-muted-foreground">{group.label}</h3> : null}
          <dl className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {group.items.map((item) => (
              <div key={item.key} className="flex min-w-0 items-center gap-1.5">
                <dt className="shrink-0 text-caption text-muted-foreground">{item.label}:</dt>
                <dd className="flex min-w-0 items-center gap-1.5">
                  {item.status}
                  {item.caption ? (
                    <span className="truncate text-caption text-muted-foreground">
                      {item.caption}
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
