"use client";

import * as React from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { toggleVariants, togglePressedClasses } from "@/components/ui/toggle";

/**
 * Segmented control — the canonical replacement for a row of buttons that
 * swap `variant` to show which one is active (dashboard period, an import
 * wizard's source mode, a matching board's status scope). Radix gives it
 * arrow-key navigation and `radiogroup` semantics, and the items join into
 * one control with shared borders, so it never reads as three loose buttons.
 *
 * A segmented control is for *switching a view*. When the choice also owns
 * page content, use `Tabs`; when it is a form value, use `RadioGroup`.
 */
function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn(
        "inline-flex w-fit items-center rounded-sm shadow-xs *:data-[slot=toggle-group-item]:shadow-none",
        className,
      )}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  React.ComponentProps<typeof toggleVariants>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        toggleVariants({ size }),
        togglePressedClasses,
        // Items butt together into a single control: only the outer edges
        // keep a radius, and shared borders collapse to one hairline.
        "rounded-none first:rounded-s-sm last:rounded-e-sm [&:not(:first-child)]:border-s-0",
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
