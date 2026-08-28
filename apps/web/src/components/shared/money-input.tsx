import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface MoneyInputProps extends Omit<React.ComponentProps<typeof Input>, "type" | "dir"> {
  /** Text alignment for the number — "end" for header/summary fields, "center" for grid cells (matches existing debit/credit columns). */
  align?: "end" | "center";
}

/**
 * The one numeric money/amount entry control (Journal Entry debit/credit,
 * document line prices/totals, transaction amounts, ...) — a thin wrapper
 * over the shared `Input` that fixes LTR digits, decimal input mode, and
 * tabular alignment so every grid formats financial numbers the same way
 * instead of re-deriving `type="number" dir="ltr" inputMode="decimal"` at
 * each call site. Pure input-props passthrough (ref, value, onChange,
 * onKeyDown, data-*, disabled, ...) — safe to drop in wherever a plain
 * `<Input type="number">` was used for money.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { className, align = "end", inputSize = "compact-md", min = 0, step = "0.01", ...props },
  ref,
) {
  return (
    <Input
      ref={ref}
      type="number"
      inputMode="decimal"
      dir="ltr"
      min={min}
      step={step}
      inputSize={inputSize}
      className={cn("tabular-nums", align === "center" ? "text-center" : "text-end", className)}
      {...props}
    />
  );
});
