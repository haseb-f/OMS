"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

/**
 * Physical alignment for a numeric field whose own direction is forced LTR.
 * `text-end` inside a `dir="ltr"` field always resolves to the right edge,
 * which breaks the shared numeric edge in Arabic (the logical end is the
 * LEFT edge there). Numeric grid inputs use this so digits, headers and
 * read-only values line up on the page's logical end in both directions.
 */
export function numericEndAlignClass(direction: "ltr" | "rtl"): string {
  return direction === "rtl" ? "text-left" : "text-right";
}

export interface MoneyInputProps extends Omit<React.ComponentProps<typeof Input>, "type" | "dir"> {
  /**
   * Kept for call-site compatibility: numeric entry always aligns to the
   * logical end edge (design-system §2). Centered amounts are not allowed.
   */
  align?: "end";
}

/**
 * The one numeric money/amount entry control (Journal Entry debit/credit,
 * document line prices/totals, transaction amounts, ...) — a thin wrapper
 * over the shared `Input` that fixes LTR digits, decimal input mode, tabular
 * digits and end alignment, so every grid formats financial numbers the same
 * way. Pure input-props passthrough (ref, value, onChange, onKeyDown,
 * data-*, disabled, ...).
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  {
    className,
    align,
    inputSize = "compact-md",
    min = 0,
    step = "0.01",
    // Illustrative only — a placeholder is never a value and is never saved.
    placeholder = "0.00",
    ...props
  },
  ref,
) {
  const { direction } = useLocale();
  // `align` is accepted for call-site compatibility only; "end" is the one alignment.
  void align;
  return (
    <Input
      ref={ref}
      type="number"
      inputMode="decimal"
      dir="ltr"
      min={min}
      step={step}
      placeholder={placeholder}
      inputSize={inputSize}
      className={cn(
        "tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        numericEndAlignClass(direction),
        className,
      )}
      {...props}
    />
  );
});
