"use client";

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { toggleVariants } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

/**
 * A short one-of-many FORM value (≤4 options) drawn as a compact segmented
 * control. Each segment IS the radio (`role="radio"`, named by its visible
 * label), so arrow-key navigation, the radio role and the accessible names
 * are exactly those of a `RadioGroup` — only the oversized radio cards are
 * gone. Use `ToggleGroup` for switching a view, not for a form value.
 */
export function SegmentedRadioGroup<T extends string>({
  value,
  onValueChange,
  options,
  disabled,
  invalid,
  className,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  // Design-system §12.4: one ringed track, the selected segment filled —
  // not a row of separately bordered buttons.
  return (
    <RadioGroupPrimitive.Root
      id={id}
      data-slot="segmented-radio-group"
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-invalid={invalid || undefined}
      orientation="horizontal"
      className={cn(
        "grid w-full auto-cols-fr grid-flow-col gap-0.5 rounded-sm bg-card p-0.5 shadow-[inset_0_0_0_1px_var(--border-strong)] aria-invalid:shadow-[inset_0_0_0_1px_var(--destructive)] sm:inline-grid sm:w-auto sm:self-start",
        className,
      )}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className={cn(
            toggleVariants({ size: "default" }),
            "h-[calc(var(--control-height-md)-4px)] min-w-0 rounded-xs border-transparent bg-transparent px-3 whitespace-normal text-muted-foreground max-sm:h-[calc(var(--control-height-lg)-4px)] [&:not(:first-child)]:border-s-0",
            "not-disabled:hover:bg-accent not-disabled:hover:text-foreground data-[state=checked]:bg-secondary data-[state=checked]:text-foreground data-[state=checked]:shadow-[inset_0_0_0_1px_var(--border)]",
          )}
        >
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
