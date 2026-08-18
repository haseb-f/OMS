import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const enterpriseButtonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm border border-transparent bg-clip-padding text-[length:var(--text-button)] leading-none font-semibold whitespace-nowrap transition-all duration-[170ms] ease-(--ease-standard) outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/18 active:not-aria-[haspopup]:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:opacity-90 [&_svg]:transition-opacity [&_svg]:duration-[170ms] [&_svg:not([class*='size-'])]:size-4 not-disabled:hover:[&_svg]:opacity-100",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border-black/18 dark:border-white/18 shadow-xs not-disabled:hover:bg-primary-hover not-disabled:hover:shadow-sm not-disabled:hover:border-black/25 dark:not-disabled:hover:border-white/25 active:not-aria-[haspopup]:bg-primary-active",
        outline:
          "border-border bg-linear-to-b from-card to-card/95 text-foreground shadow-xs not-disabled:hover:bg-primary-soft not-disabled:hover:text-primary not-disabled:hover:shadow-sm not-disabled:hover:border-primary/40 aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:not-disabled:hover:bg-primary-soft",
        secondary:
          "bg-linear-to-b from-secondary to-secondary/95 text-secondary-foreground border-black/10 dark:border-white/12 shadow-xs not-disabled:hover:shadow-sm not-disabled:hover:brightness-[1.03] not-disabled:hover:border-black/16 dark:not-disabled:hover:border-white/18 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        info: "bg-info text-info-foreground border-black/18 dark:border-white/18 shadow-xs not-disabled:hover:shadow-md not-disabled:hover:brightness-90 not-disabled:hover:border-black/25 dark:not-disabled:hover:border-white/25 aria-expanded:brightness-90",
        warning:
          "bg-warning text-warning-foreground border-black/18 dark:border-white/18 shadow-xs not-disabled:hover:shadow-md not-disabled:hover:brightness-90 not-disabled:hover:border-black/25 dark:not-disabled:hover:border-white/25 aria-expanded:brightness-90",
        ghost:
          "not-disabled:hover:bg-primary-soft not-disabled:hover:text-primary not-disabled:hover:border-black/5 not-disabled:hover:shadow-xs dark:not-disabled:hover:border-white/10 aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "bg-destructive-soft text-destructive not-disabled:hover:bg-destructive/20 not-disabled:hover:border-destructive/30 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:not-disabled:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 not-disabled:hover:underline",
      },
      size: {
        // Three-tier scale (small/medium/large), TASK-042 — `default` is
        // the "medium" tier; kept named `default` since it's the implicit
        // size at every call site that omits `size` entirely.
        default:
          "h-(--control-height-md) gap-1.5 px-3 has-data-[icon=inline-end]:pe-2.5 has-data-[icon=inline-start]:ps-2.5",
        xs: "h-6 gap-1 px-2 text-xs font-medium in-data-[slot=button-group]:rounded-sm has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-(--control-height-sm) gap-1.5 px-2.5 text-[length:var(--text-caption)] font-medium in-data-[slot=button-group]:rounded-sm has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2 [&_svg:not([class*='size-'])]:size-4",
        inline: "h-auto min-h-0 gap-1 px-0 py-0 font-medium [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-(--control-height-lg) gap-2 px-4 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3",
        icon: "size-9",
        "icon-xs":
          "size-6 in-data-[slot=button-group]:rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-8 in-data-[slot=button-group]:rounded-sm [&_svg:not([class*='size-'])]:size-4",
        "icon-lg": "size-11 [&_svg:not([class*='size-'])]:size-[1.125rem]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const EnterpriseButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> &
    VariantProps<typeof enterpriseButtonVariants> & {
      asChild?: boolean;
      isLoading?: boolean;
    }
>(function EnterpriseButton(
  {
    className,
    variant = "default",
    size = "default",
    asChild = false,
    isLoading = false,
    disabled,
    children,
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      ref={ref}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(enterpriseButtonVariants({ variant, size, className }))}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {isLoading ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}
          {children}
        </>
      )}
    </Comp>
  );
});

export { EnterpriseButton, enterpriseButtonVariants };
