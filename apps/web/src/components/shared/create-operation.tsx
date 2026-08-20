"use client";

import type { ReactNode } from "react";
import { EnterpriseButton } from "@/components/ui/button";
import { SubmitButton } from "@/components/shared/form-fields/submit-button";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

/**
 * Surface rule for create/edit (reuse these, never invent a fourth):
 * - `EnterpriseModal` (dialog) — focused create/edit, short action
 * - Sheet — contextual detail / quick inspect
 * - Full page — invoices, journal entries, multi-section workflows
 *
 * Layout inside a create surface:
 * Context → Main data → Related data → Notes/attachments → Summary → Actions
 */
export function CreateOperationLayout({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex flex-col gap-3", className)}>{children}</div>;
}

function isSummaryValueEmpty(value: ReactNode): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Compact live summary generated from the current form/editor state.
 * Key-value grid — not a second form, not a giant totals card.
 */
export function CreateOperationSummary({
  title,
  rows,
  className,
}: {
  title: string;
  rows: { label: string; value: ReactNode }[];
  className?: string;
}) {
  const visible = rows.filter((row) => !isSummaryValueEmpty(row.value));
  if (visible.length === 0) return null;

  return (
    <section className={cn("rounded-md border border-border bg-muted/30 px-3 py-2", className)}>
      <h3 className="mb-1.5 text-caption font-semibold">{title}</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {visible.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-caption text-muted-foreground">{row.label}</dt>
            <dd className="text-caption font-medium text-end">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Review / totals block. The last emphasized row is the operational total. */
export function CreateOperationTotals({
  label,
  children,
  rows,
}: {
  label?: string;
  children?: ReactNode;
  rows?: { label: string; value: ReactNode; emphasis?: "normal" | "strong" }[];
}) {
  if (rows?.length) {
    return (
      <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 px-3 py-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <span
              className={
                row.emphasis === "strong"
                  ? "text-caption font-semibold"
                  : "text-caption text-muted-foreground"
              }
            >
              {row.label}
            </span>
            <div
              className={row.emphasis === "strong" ? "text-caption font-semibold" : "text-caption"}
            >
              {row.value}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
      <span className="text-caption text-muted-foreground">{label}</span>
      <div className="text-caption font-semibold">{children}</div>
    </div>
  );
}

/** Sticky modal footer: ghost Cancel never competes with the primary Save. */
export function CreateOperationFooter({
  requestClose,
  onSubmit,
  isSubmitting,
  submitLabel,
  submitDisabled,
}: {
  requestClose: () => void;
  onSubmit: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
  submitDisabled?: boolean;
}) {
  const { t } = useLocale();

  return (
    <>
      <EnterpriseButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={requestClose}
        disabled={isSubmitting}
      >
        {t("common.cancel")}
      </EnterpriseButton>
      <SubmitButton
        type="button"
        size="sm"
        isSubmitting={isSubmitting}
        disabled={submitDisabled}
        onClick={onSubmit}
      >
        {submitLabel ?? t("common.save")}
      </SubmitButton>
    </>
  );
}
