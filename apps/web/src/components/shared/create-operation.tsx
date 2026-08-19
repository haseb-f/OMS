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
 * Context → Main data → Related data → Notes/attachments → Totals → Actions
 */
export function CreateOperationLayout({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex flex-col gap-5", className)}>{children}</div>;
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
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/40 px-3 py-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <span
              className={
                row.emphasis === "strong"
                  ? "text-body font-semibold"
                  : "text-caption text-muted-foreground"
              }
            >
              {row.label}
            </span>
            <div className={row.emphasis === "strong" ? "text-body font-semibold" : "text-caption"}>
              {row.value}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
      <span className="text-caption text-muted-foreground">{label}</span>
      <div className="text-body font-semibold">{children}</div>
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
        onClick={requestClose}
        disabled={isSubmitting}
      >
        {t("common.cancel")}
      </EnterpriseButton>
      <SubmitButton
        type="button"
        isSubmitting={isSubmitting}
        disabled={submitDisabled}
        onClick={onSubmit}
      >
        {submitLabel ?? t("common.save")}
      </SubmitButton>
    </>
  );
}
