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

/**
 * The common "label + input + help text + error" case, wired to
 * react-hook-form — reduces the FormField/FormItem/FormControl boilerplate
 * every business form would otherwise repeat.
 */
export function TextFormField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({
  control,
  name,
  label,
  description,
  disabled,
  required,
  optional,
  ...inputProps
}: {
  control: Control<TFieldValues>;
  name: TName;
  label: string;
  description?: string;
  disabled?: boolean;
  required?: boolean;
  optional?: boolean;
} & Omit<React.ComponentProps<typeof Input>, "name" | "disabled">) {
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
              {...field}
              {...inputProps}
              dir={inputProps.dir ?? (inputProps.type === "email" ? "ltr" : undefined)}
              disabled={disabled}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
