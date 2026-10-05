"use client";

import type { ReactNode } from "react";
import { useFormContext } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@/components/shared/searchable-select";
import type { EntityComboboxCreateAction } from "@/components/shared/entity-combobox";
import type { ProductFormValues } from "@/config/products/schema";
import { cn } from "@/lib/utils";

type SelectName =
  "categoryId" | "unitId" | "taxId" | "brandId" | "analyticAccountId" | "ownerAgentId";

/**
 * A reference-data selector bound to the product form (category, unit, tax,
 * brand, cost center, owner agent): label, the shared searchable select, an
 * optional hint under it and the validation message. `selectedLabel` names a
 * value that is not among the (active-only) options — an archived record.
 */
export function ReferenceSelectField({
  name,
  label,
  options,
  required,
  optional,
  placeholder,
  selectedLabel,
  createAction,
  allowClear,
  disabled,
  hint,
  onValueChange,
  dataSize,
  className,
}: {
  name: SelectName;
  label: string;
  options: SearchableSelectOption[];
  required?: boolean;
  optional?: boolean;
  placeholder?: string;
  selectedLabel?: string;
  createAction?: EntityComboboxCreateAction;
  allowClear?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
  /** Runs after the USER picks — never for the form's own programmatic defaults. */
  onValueChange?: (value: string) => void;
  /** `FieldGrid` basis of this cell. */
  dataSize?: "xs" | "sm" | "md" | "lg" | "full";
  className?: string;
}) {
  const { control } = useFormContext<ProductFormValues>();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem data-size={dataSize} className={className}>
          <FormLabel required={required} optional={optional}>
            {label}
          </FormLabel>
          <FormControl>
            <SearchableSelect
              value={field.value}
              onValueChange={(value) => {
                field.onChange(value);
                onValueChange?.(value);
              }}
              options={options}
              placeholder={placeholder ?? label}
              selectedLabel={selectedLabel}
              createAction={createAction}
              allowClear={allowClear}
              disabled={disabled}
            />
          </FormControl>
          {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/**
 * One independent yes/no attribute (can be sold, can be purchased, track stock,
 * investor eligibility): the switch, its label and an optional one-line note —
 * the reason a locked switch is locked, or what it means. Never a hidden rule:
 * a forced value is shown disabled with its reason.
 */
export function SwitchRow({
  id,
  label,
  checked,
  onCheckedChange,
  disabled,
  note,
  noteTone = "muted",
  className,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  note?: ReactNode;
  noteTone?: "muted" | "warning";
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <label htmlFor={id} className="flex items-center gap-2 text-body">
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          aria-describedby={note ? `${id}-note` : undefined}
        />
        {label}
      </label>
      {note ? (
        <p
          id={`${id}-note`}
          className={cn(
            "text-caption ps-9",
            noteTone === "warning" ? "text-warning-soft-foreground" : "text-muted-foreground",
          )}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}
