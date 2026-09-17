import type { Control, FieldPath, FieldValues } from "react-hook-form";
import { FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { fromISODate, toISODate } from "@/lib/date";

export function DateFormField<
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
}: {
  control: Control<TFieldValues>;
  name: TName;
  label: string;
  description?: string;
  required?: boolean;
  optional?: boolean;
  disabled?: boolean;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem>
          <FormLabel required={required} optional={optional}>
            {label}
          </FormLabel>
          <EnterpriseDatePicker
            value={fromISODate(field.value)}
            onChange={(date) => field.onChange(date ? toISODate(date) : "")}
            disabled={disabled}
            className="w-full"
            aria-invalid={!!fieldState.error}
          />
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
