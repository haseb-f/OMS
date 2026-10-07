"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/ui/form";
import { cn } from "@/lib/utils";

/**
 * Compact data-entry form (spec "Round 3.2",
 * design-system §12.9). Supersedes the Round 3.1 single-column tinted
 * panels: a creation form is a stack of compact sections split by hairline
 * dividers, and short related fields share a row (`FieldGrid`), each sized
 * to its content (`Field size`).
 *
 * `EnterpriseModal layout="form-card"` provides the context, so shared building blocks (`FormSection`, `AmountStrip`,
 * `CreateOperationSummary`, the payment declaration) adopt the pattern
 * without per-screen code. Outside that context nothing changes.
 */
const FormCardContext = createContext(false);

export function FormCardProvider({ active, children }: { active: boolean; children: ReactNode }) {
  return <FormCardContext.Provider value={active}>{children}</FormCardContext.Provider>;
}

/** True inside an active compact form card. */
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

/**
 * One compact section: a one-line heading (an optional short note on the
 * same line), then its fields. Sections after the first are separated by a
 * hairline — never a tinted card inside the dialog card.
 */
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
  /** A short muted note, on the heading line where it fits. */
  description?: ReactNode;
  /** Small controls at the heading's logical end. */
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
      className={cn(
        "@container flex min-w-0 flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0",
        className,
      )}
    >
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h3 className="text-body font-semibold text-foreground">{title}</h3>
          {description ? <p className="text-caption text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Content-based basis of a field inside a `FieldGrid` (tokens `--field-*`). */
export type FieldSize = "xs" | "sm" | "md" | "lg" | "full";

/**
 * Compact field grid: short related fields share a row on desktop, each
 * starting at its `Field size` and growing in proportion; the row wraps to
 * two columns and then one on narrow screens (never sideways scrolling).
 *
 * The layout is carried by `data-slot`/`data-size` and applied by the field
 * grid recipe (`theme/recipes.css`).
 */
export function FieldGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-slot="field-grid" className={className}>
      {children}
    </div>
  );
}

/** One field cell of a `FieldGrid` (label above its control). */
export function Field({
  size = "md",
  children,
  className,
  "data-field-name": fieldName,
  "data-invalid": invalid,
}: {
  size?: FieldSize;
  children: ReactNode;
  className?: string;
  "data-field-name"?: string;
  "data-invalid"?: "true";
}) {
  return (
    <div
      data-slot="field"
      data-size={size}
      data-field-name={fieldName}
      data-invalid={invalid}
      className={cn("flex min-w-0 flex-col gap-1", className)}
    >
      {children}
    </div>
  );
}

/** Short related fields side by side (a `FieldGrid`). */
export function FormCardRow({ children, className }: { children: ReactNode; className?: string }) {
  return <FieldGrid className={className}>{children}</FieldGrid>;
}

/** Label above its control, with an optional message underneath. */
export function FormCardField({
  label,
  htmlFor,
  required,
  message,
  children,
  size = "full",
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  /** A field-level message (e.g. a `FieldMessage`). */
  message?: ReactNode;
  children: ReactNode;
  /** Basis inside a `FormCardRow`; ignored in a plain stack. */
  size?: FieldSize;
  className?: string;
}) {
  return (
    <Field size={size} className={className}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <RequiredMark /> : null}
      </Label>
      {children}
      {message}
    </Field>
  );
}
