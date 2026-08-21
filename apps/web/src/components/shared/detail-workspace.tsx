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
 */
export function DetailWorkspace({
  title,
  subtitle,
  status,
  actions,
  children,
  width = "default",
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  /** `default` for party/order profiles; `wide` for document editors with line grids. */
  width?: "default" | "wide";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-2",
        width === "wide" ? "max-w-6xl" : "max-w-[1100px]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-0">
            <h1 className="text-ui-title font-semibold tracking-tight" dir="auto">
              {title}
            </h1>
            {hasDetailValue(subtitle) ? (
              <p className="text-caption text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          {status}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>
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
 * journal entries) shows the same three things — what the document is, its
 * number, and its state — so they share one row rather than four copies that
 * drift apart. `documentNumber` is forced LTR: document codes stay
 * left-to-right even in the Arabic interface.
 */
export function EditorHeader({
  title,
  documentNumber,
  status,
  actions,
}: {
  title: ReactNode;
  documentNumber?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-ui-title font-semibold tracking-tight">{title}</h1>
          {hasDetailValue(documentNumber) ? (
            <p dir="ltr" className="truncate text-caption text-muted-foreground">
              {documentNumber}
            </p>
          ) : null}
        </div>
        {status}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
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
        "grid grid-cols-2 gap-x-3 gap-y-2 rounded-md border border-border bg-card p-3 shadow-[0_1px_0_0_color-mix(in_oklab,var(--border)_80%,transparent)] ring-1 ring-border/60 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
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
