"use client";

import * as React from "react";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * OMS Global Scroll System — the Radix-backed half. Most existing overflow
 * containers (tables, dialogs, dropdowns, the sidebar) use the global
 * native-scrollbar normalization in globals.css instead (zero layout risk,
 * see that file's comment) — reach for this component only when a
 * genuinely isolated scroll region needs Radix's own viewport (e.g. a new
 * Transaction Workspace panel). Styled from the same --scrollbar-* tokens
 * either way, so the two never look different.
 */
function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="size-full rounded-[inherit] outline-none focus-visible:outline-1 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollBar orientation="horizontal" />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none select-none transition-colors duration-(--duration-base)",
        orientation === "vertical" &&
          "h-full w-(--scrollbar-size) border-s border-s-transparent p-px",
        orientation === "horizontal" &&
          "h-(--scrollbar-size) flex-col border-t border-t-transparent p-px",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-(--scrollbar-thumb) transition-colors duration-(--duration-base) hover:bg-(--scrollbar-thumb-hover) active:bg-(--scrollbar-thumb-active)"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
