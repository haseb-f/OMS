import type { Control, FieldPath, FieldValues } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

export function NumberFormField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({
  control,
  name,
  label,
  description,
  required,
  optional,
  disabled,
  min,
  max,
  step,
  inputSize = "md",
}: {
  control: Control<TFieldValues>;
  name: TName;
  label: string;
  description?: string;
  required?: boolean;
  optional?: boolean;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: string | number;
  inputSize?: "sm" | "md" | "lg" | "compact-md";
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel required={required} optional={optional}>
            {label}
          </FormLabel>
          <FormControl>
            <Input
              type="number"
              inputMode="decimal"
              dir="ltr"
              inputSize={inputSize}
              min={min}
              max={max}
              step={step}
              disabled={disabled}
              value={field.value ?? ""}
              onChange={(event) => {
                const raw = event.target.valueAsNumber;
                field.onChange(Number.isNaN(raw) ? undefined : raw);
              }}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
