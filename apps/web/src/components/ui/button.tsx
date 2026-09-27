import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const enterpriseButtonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm border border-transparent text-[length:var(--text-button)] leading-none font-medium whitespace-nowrap transition-colors duration-(--duration-base) ease-(--ease-standard) outline-none select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /** The ONE primary action of a context — solid brand navy. */
        default:
          "bg-primary text-primary-foreground not-disabled:hover:bg-primary-hover active:not-aria-[haspopup]:bg-primary-active",
        /** Secondary actions: solid surface, neutral hairline, neutral hover. */
        outline:
          "border-border-strong bg-card text-foreground not-disabled:hover:bg-accent aria-expanded:bg-accent",
        /**
         * A trigger that behaves like a form field (pickers, comboboxes,
         * filter triggers, date/month pickers): input boundary, normal
         * weight, focus/open state drawn like an Input.
         */
        field:
          "border-input bg-card font-normal text-foreground not-disabled:hover:border-foreground/45 aria-expanded:border-focus-ring aria-expanded:ring-1 aria-expanded:ring-focus-ring focus-visible:outline-0 focus-visible:border-focus-ring focus-visible:ring-1 focus-visible:ring-focus-ring aria-invalid:ring-1 aria-invalid:ring-destructive",
        secondary:
          "border-border bg-secondary text-secondary-foreground not-disabled:hover:bg-accent aria-expanded:bg-accent",
        info: "bg-info text-info-foreground not-disabled:hover:bg-info/90",
        /** The one green "primary positive" action (Activate, Approve, ...) — never a one-off inline green className. */
        success: "bg-success text-success-foreground not-disabled:hover:bg-success/90",
        warning: "bg-warning text-warning-foreground not-disabled:hover:bg-warning/90",
        ghost: "text-foreground not-disabled:hover:bg-accent aria-expanded:bg-accent",
        destructive:
          "border-destructive-border bg-destructive-soft text-destructive-soft-foreground not-disabled:hover:border-destructive not-disabled:hover:bg-destructive not-disabled:hover:text-destructive-foreground",
        link: "text-primary underline-offset-4 not-disabled:hover:underline dark:text-primary",
      },
      size: {
        // One height scale shared with Input/Select (theme/tokens.css):
        // default = --control-height-md (32px; 40px on touch pointers).
        default:
          "h-(--control-height-md) gap-1.5 px-3 has-data-[icon=inline-end]:pe-2.5 has-data-[icon=inline-start]:ps-2.5",
        xs: "h-(--control-height-xs) gap-1 px-2 text-micro font-medium in-data-[slot=button-group]:rounded-xs has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-(--control-height-sm) gap-1.5 px-2.5 text-[length:var(--text-caption)] in-data-[slot=button-group]:rounded-xs has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2 [&_svg:not([class*='size-'])]:size-3.5",
        inline: "h-auto min-h-0 gap-1 border-0 px-0 py-0 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-(--control-height-lg) gap-2 px-4 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3",
        icon: "size-(--control-height-md)",
        "icon-xs":
          "size-(--control-height-xs) in-data-[slot=button-group]:rounded-xs [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-(--control-height-sm) in-data-[slot=button-group]:rounded-xs [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-(--control-height-lg) [&_svg:not([class*='size-'])]:size-[1.125rem]",
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
          {isLoading ? <Spinner /> : null}
          {children}
        </>
      )}
    </Comp>
  );
});

export { EnterpriseButton, enterpriseButtonVariants };
