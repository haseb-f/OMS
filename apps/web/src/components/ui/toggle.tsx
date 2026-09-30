"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Toggle as TogglePrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * A button whose pressed state is the value — list toolbar filters like
 * "include archived" or "loss-making only". Built on the same height/radius
 * scale as `EnterpriseButton` so it lines up inside a filter bar, but it
 * carries `aria-pressed` and a persistent active tint, which a plain button
 * with a swapped `variant` never did.
 */
const toggleVariants = cva(
  "group/toggle inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-sm border border-(--control-border) bg-card shadow-(--control-shadow) text-[length:var(--text-button)] leading-none font-medium whitespace-nowrap text-foreground transition-colors duration-(--duration-base) ease-(--ease-standard) outline-none select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      size: {
        sm: "h-(--control-height-sm) px-2.5 text-[length:var(--text-caption)]",
        default: "h-(--control-height-md) px-3",
        "icon-sm": "size-(--control-height-sm) p-0",
      },
    },
    defaultVariants: {
      size: "sm",
    },
  },
);

/**
 * Shared pressed-state tint (primary soft + primary text — an applied
 * filter, design-system §12.12). `ToggleGroup` items take the segmented
 * recipe instead.
 */
const togglePressedClasses =
  "not-disabled:hover:border-(--control-border-hover) not-disabled:hover:bg-(--control-hover) data-[state=on]:border-primary/40 data-[state=on]:bg-primary-soft data-[state=on]:text-primary data-on:border-primary/40 data-on:bg-primary-soft data-on:text-primary";

function Toggle({
  className,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ size }), togglePressedClasses, className)}
      {...props}
    />
  );
}

export { Toggle, toggleVariants, togglePressedClasses };
