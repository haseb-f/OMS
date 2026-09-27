import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One group of fields inside a single dialog or editor surface
 * (design-system §11.3): a concise heading and a hairline divider from the
 * previous group — never a bordered card per section. Consecutive sections
 * separate themselves (`border-t` on every section but the first), so a
 * dialog body is simply a stack of `FormSection`s.
 *
 * The body is a plain block: callers lay out their own field grid, and a
 * full-width child (a line table, a notes field) keeps the full width.
 */
export function FormSection({
  title,
  description,
  actions,
  children,
  className,
  "data-field-name": fieldName,
  "data-invalid": invalid,
}: {
  title: ReactNode;
  /** One muted line under the heading. */
  description?: ReactNode;
  /** Small controls at the heading's logical end (e.g. "Browse products"). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Lets a `FormErrorSummary` item focus this group (`fieldId`). */
  "data-field-name"?: string;
  "data-invalid"?: "true";
}) {
  return (
    <section
      data-slot="form-section"
      data-field-name={fieldName}
      data-invalid={invalid}
      className={cn(
        "@container flex min-w-0 flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0",
        className,
      )}
    >
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-col">
          <h3 className="text-body font-semibold">{title}</h3>
          {description ? <p className="text-caption text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/**
 * Compact figures row (order total · paid · remaining): right-sized, on the
 * sunken surface, aligned to the numeric edge. The `strong` item is the
 * operational total. Presentation only — callers pass formatted values.
 */
export function AmountStrip({
  items,
  label,
  className,
}: {
  items: { key: string; label: ReactNode; value: ReactNode; strong?: boolean }[];
  /** Accessible name for the figures. */
  label?: string;
  className?: string;
}) {
  return (
    <dl
      aria-label={label}
      data-slot="amount-strip"
      className={cn(
        "flex flex-wrap items-baseline justify-end gap-x-6 gap-y-1 rounded-md bg-surface-sunken px-3 py-2",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.key} className="flex items-baseline gap-2">
          <dt
            className={cn(
              "text-caption",
              item.strong ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {item.label}
          </dt>
          <dd
            dir="ltr"
            className={cn(
              "num",
              item.strong ? "text-card-title font-semibold" : "text-body font-medium",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
