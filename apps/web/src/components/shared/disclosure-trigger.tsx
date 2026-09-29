"use client";

import { forwardRef, type ComponentProps } from "react";

import { EnterpriseButton } from "@/components/ui/button";
import { TriggerChevron } from "@/components/ui/trigger-chevron";
import { cn } from "@/lib/utils";

/**
 * The one "show more" control for progressive disclosure inside forms and
 * editors (More details, Notes & terms, optional sections). Use it as
 * `<CollapsibleTrigger asChild><DisclosureTrigger>…</DisclosureTrigger>`:
 * the collapsible's `data-state` turns the caret, the label reads in full
 * foreground at button weight, and the ghost surface keeps it quieter than
 * a real action.
 */
export const DisclosureTrigger = forwardRef<
  HTMLButtonElement,
  ComponentProps<typeof EnterpriseButton>
>(function DisclosureTrigger({ className, children, ...props }, ref) {
  return (
    <EnterpriseButton
      ref={ref}
      type="button"
      variant="ghost"
      size="sm"
      className={cn("w-fit gap-1.5 px-1.5", className)}
      {...props}
    >
      <TriggerChevron kind="disclosure" size="sm" />
      {children}
    </EnterpriseButton>
  );
});
