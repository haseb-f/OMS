"use client";

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type { LucideIcon } from "lucide-react";
import { toggleVariants } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

/**
 * A short one-of-many FORM value (≤4 options) drawn as a compact segmented
 * control. Each segment IS the radio (`role="radio"`, named by its visible
 * label), so arrow-key navigation, the radio role and the accessible names
 * are exactly those of a `RadioGroup` — only the oversized radio cards are
 * gone. Use `ToggleGroup` for switching a view, not for a form value.
 *
 * Round 5 (design-system §12.12): the track, segments and selected state
 * are the shared segmented recipe (same silhouette as `ToggleGroup` and
 * `ButtonGroup`); an option may carry a leading Lucide icon.
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
  options: { value: T; label: string; icon?: LucideIcon }[];
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
        "grid w-full auto-cols-fr grid-flow-col sm:inline-grid sm:w-auto sm:self-start",
        className,
      )}
    >
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <RadioGroupPrimitive.Item
            key={option.value}
            value={option.value}
            data-slot="segmented-radio-item"
            className={cn(
              toggleVariants({ size: "default" }),
              "h-[calc(var(--control-height-md)-4px)] min-w-0 px-3 whitespace-normal max-sm:h-[calc(var(--control-height-lg)-4px)]",
            )}
          >
            {Icon ? <Icon aria-hidden /> : null}
            {option.label}
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}
