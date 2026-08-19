import * as React from "react";

import { cn } from "@/lib/utils";

function EnterpriseCard({
  className,
  size = "default",
  clickable = false,
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm"; clickable?: boolean }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-clickable={clickable}
      className={cn(
        // Flat on-page surface: one crisp 1px border, no gradient fill and no
        // resting shadow. Elevation is reserved for genuinely floating layers
        // (menus, popovers, dialogs) so a page of cards reads as one dense
        // console rather than a stack of raised panels.
        "group/card flex flex-col gap-4 overflow-hidden rounded-md border border-border bg-card py-(--card-spacing) text-body text-card-foreground transition-colors duration-[170ms] ease-(--ease-standard) [--card-spacing:--spacing(5)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:[--card-spacing:--spacing(4)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 data-[clickable=true]:cursor-pointer data-[clickable=true]:hover:border-foreground/20 data-[clickable=true]:hover:bg-muted/30 *:[img:first-child]:rounded-t-md *:[img:last-child]:rounded-b-md",
        className,
      )}
      {...props}
    />
  );
}

function EnterpriseCardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1.5 rounded-t-md px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

function EnterpriseCardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-card-title leading-snug group-data-[size=sm]/card:text-body",
        className,
      )}
      {...props}
    />
  );
}

function EnterpriseCardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-caption text-muted-foreground", className)}
      {...props}
    />
  );
}

function EnterpriseCardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

function EnterpriseCardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn("px-(--card-spacing)", className)} {...props} />
  );
}

function EnterpriseCardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-md border-t bg-muted/40 px-(--card-spacing) py-3",
        className,
      )}
      {...props}
    />
  );
}

export {
  EnterpriseCard,
  EnterpriseCardHeader,
  EnterpriseCardFooter,
  EnterpriseCardTitle,
  EnterpriseCardAction,
  EnterpriseCardDescription,
  EnterpriseCardContent,
};
