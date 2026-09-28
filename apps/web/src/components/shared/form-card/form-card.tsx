"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Round 3.1 PILOT — vertical data-entry card (spec "Round 3.1" item 3,
 * design-system §12). A creation form reads top to bottom as a stack of
 * softly tinted section panels inside a bounded (520–640px) dialog: one
 * field column, short related fields paired with `FormCardRow`.
 *
 * `EnterpriseModal layout="form-card"` provides the context while the pilot
 * is active, so shared building blocks (`FormSection`, `AmountStrip`,
 * `CreateOperationSummary`, the payment declaration) adopt the pattern
 * without per-screen code. Outside that context nothing changes.
 *
 * Visual properties (tint, hairline, radius) come from the "Round 3.1 form
 * card" tokens/recipes at the end of `theme/pilot-geist.css`.
 */
const FormCardContext = createContext(false);

export function FormCardProvider({ active, children }: { active: boolean; children: ReactNode }) {
  return <FormCardContext.Provider value={active}>{children}</FormCardContext.Provider>;
}

/** True inside an active vertical form card. */
export function useFormCard(): boolean {
  return useContext(FormCardContext);
}

/** Vertical stack of `FormCardSection`s (the card body). */
export function FormCardStack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex min-w-0 flex-col gap-3", className)}>{children}</div>;
}

/** One tinted section panel: a title, a one-line description, then its fields. */
export function FormCardSection({
  title,
  description,
  actions,
  children,
  className,
  "data-field-name": fieldName,
  "data-invalid": invalid,
}: {
  title: ReactNode;
  /** One muted line under the title. */
  description?: ReactNode;
  /** Small controls at the title's logical end. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Lets a `FormErrorSummary` item focus this group (`fieldId`). */
  "data-field-name"?: string;
  "data-invalid"?: "true";
}) {
  return (
    <section
      data-slot="form-card-section"
      data-field-name={fieldName}
      data-invalid={invalid}
      className={cn("@container flex min-w-0 flex-col gap-3 p-4 max-sm:p-3", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-body font-semibold text-foreground">{title}</h3>
          {description ? <p className="text-caption text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/**
 * Pairs short related fields (quantity + price, date + time, type +
 * outcome) side by side when the section is wide enough; one column below.
 */
export function FormCardRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-x-3 gap-y-3 @sm:grid-cols-2", className)}>
      {children}
    </div>
  );
}

/** Label above its control, with an optional message underneath. */
export function FormCardField({
  label,
  htmlFor,
  required,
  message,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  /** A field-level message (e.g. a `FieldMessage`). */
  message?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {message}
    </div>
  );
}
