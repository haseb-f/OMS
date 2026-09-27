import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const enterpriseBadgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-xs border px-1.5 py-0 text-[length:var(--text-micro)] leading-none font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus-ring has-data-[icon=inline-end]:pe-1 has-data-[icon=inline-start]:ps-1 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      /**
       * Status tones — soft surface + AA foreground + hairline border
       * (tokens: --{tone}-soft / -soft-foreground / -border). Status is
       * never carried by color alone: the label always names the state.
       */
      variant: {
        default: "border-transparent bg-primary text-primary-foreground [a]:hover:bg-primary-hover",
        secondary: "border-neutral-border bg-neutral-soft text-neutral-soft-foreground",
        success: "border-success-border bg-success-soft text-success-soft-foreground",
        warning: "border-warning-border bg-warning-soft text-warning-soft-foreground",
        destructive:
          "border-destructive-border bg-destructive-soft text-destructive-soft-foreground",
        info: "border-info-border bg-info-soft text-info-soft-foreground",
        outline: "border-border-strong bg-card text-foreground [a]:hover:bg-accent",
        ghost: "border-transparent hover:bg-accent",
        link: "border-transparent text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function EnterpriseBadge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof enterpriseBadgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(enterpriseBadgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { EnterpriseBadge, enterpriseBadgeVariants };
