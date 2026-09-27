import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Shared Input Sizing System (TASK-042) — the one height/padding/font scale
 * every text/number input in OMS draws from, mirroring the Button size
 * scale (`ui/button.tsx`) so form rows built from both stay visually
 * aligned. `inputSize` (not `size`) — `<input>` already has a native HTML
 * `size` attribute (character-width count), so reusing that name would
 * silently shadow it.
 */
const inputVariants = cva(
  "w-full min-w-0 rounded-sm border border-input bg-card transition-[border-color,box-shadow] duration-(--duration-base) ease-(--ease-standard) outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-caption file:font-medium file:text-foreground placeholder:text-placeholder not-disabled:not-read-only:hover:border-foreground/45 focus-visible:border-focus-ring focus-visible:ring-1 focus-visible:ring-focus-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 read-only:cursor-default read-only:border-border read-only:bg-surface-sunken aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive",
  {
    variants: {
      inputSize: {
        xs: "h-(--control-height-xs) px-2 py-0.5 text-micro",
        sm: "h-(--control-height-sm) px-2.5 py-1 text-caption",
        md: "h-(--control-height-md) px-3 py-1.5 text-body",
        lg: "h-(--control-height-lg) px-4 py-2 text-body",
        // Line-item grids (Sales document editors): sm's compact 32px row
        // height, kept at md's roomier padding/font so financial figures
        // stay fully legible in a dense, many-column row.
        "compact-md": "h-(--control-height-md) px-3 py-1.5 text-body",
      },
    },
    defaultVariants: {
      inputSize: "compact-md",
    },
  },
);

function Input({
  className,
  type,
  inputSize,
  ...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputVariants({ inputSize }), className)}
      {...props}
    />
  );
}

export { Input, inputVariants };
