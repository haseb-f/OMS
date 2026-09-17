import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Inline, in-context feedback that must persist — a form-level submit error,
 * a standing warning about a record's state. A transient confirmation of an
 * action the user just took is a toast (`@/lib/toast`), never this; an empty
 * or failed *section* is `EmptyState` / `ErrorState`.
 *
 * Tones reuse the semantic `*-soft` tokens, so an alert flips with dark mode
 * on its own and never needs a one-off colour at the call site.
 */
const alertVariants = cva(
  "flex items-start gap-2 rounded-sm border px-3 py-2 text-caption [&>svg]:mt-px [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      tone: {
        destructive: "border-destructive/20 bg-destructive-soft text-destructive",
        warning: "border-warning/25 bg-warning-soft text-warning-foreground",
        success: "border-success/25 bg-success-soft text-success-foreground",
        info: "border-info/25 bg-info-soft text-info-foreground",
        neutral: "border-border bg-muted/40 text-muted-foreground",
      },
    },
    defaultVariants: {
      tone: "destructive",
    },
  },
);

function Alert({
  className,
  tone,
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-tone={tone ?? "destructive"}
      role="alert"
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      {children}
    </div>
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p data-slot="alert-title" className={cn("font-semibold text-current", className)} {...props} />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("min-w-0 flex-1 [&_p]:leading-relaxed", className)}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, alertVariants };
