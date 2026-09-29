import type { Control, FieldPath, FieldValues } from "react-hook-form";
import type { CountryCode } from "libphonenumber-js/min";
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
  onCountryChange,
  availableCountryCodes,
}: {
  control: Control<TFieldValues>;
  name: TName;
  label: string;
  description?: string;
  required?: boolean;
  optional?: boolean;
  disabled?: boolean;
  countryCode?: string | null;
  /** See `OMSPhoneInput` — offered as an explicit "Switch country to …" action on a calling-code conflict. */
  onCountryChange?: (iso2: CountryCode) => void;
  availableCountryCodes?: readonly string[];
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState, formState }) => (
        <FormItem>
          <FormLabel required={required} optional={optional}>
            {label}
          </FormLabel>
          <OMSPhoneInput
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            countryCode={countryCode}
            onCountryChange={onCountryChange}
            availableCountryCodes={availableCountryCodes}
            forceValidation={formState.isSubmitted}
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
