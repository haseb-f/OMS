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
        "grid w-full auto-cols-fr grid-flow-col rounded-sm sm:inline-grid sm:w-auto sm:self-start",
        className,
      )}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className={cn(
            toggleVariants({ size: "default" }),
            "min-w-0 rounded-none px-3 whitespace-normal first:rounded-s-sm last:rounded-e-sm max-sm:h-(--control-height-lg) [&:not(:first-child)]:border-s-0",
            "not-disabled:hover:bg-accent data-[state=checked]:bg-primary-soft data-[state=checked]:ring-1 data-[state=checked]:ring-primary data-[state=checked]:ring-inset data-[state=checked]:text-primary",
            invalid && "border-destructive",
          )}
        >
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
