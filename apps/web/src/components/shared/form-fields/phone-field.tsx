import type { Control, FieldPath, FieldValues } from "react-hook-form";
import { FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { OMSPhoneInput } from "@/components/shared/phone-input";

export function PhoneFormField<
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
  countryCode,
}: {
  control: Control<TFieldValues>;
  name: TName;
  label: string;
  description?: string;
  required?: boolean;
  optional?: boolean;
  disabled?: boolean;
  countryCode?: string | null;
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
          <OMSPhoneInput
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            countryCode={countryCode}
            disabled={disabled}
            aria-invalid={!!fieldState.error}
          />
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
