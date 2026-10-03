"use client";

import type { ComponentProps } from "react";
import type { Control, FieldPath, FieldValues } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { PasswordInput } from "@/components/shared/password-input";

/**
 * RHF password field — the label/message frame around the shared
 * `PasswordInput` (one implementation: Show/Hide, Copy of the typed value,
 * LTR value with an RTL label).
 */
export function PasswordFormField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({
  control,
  name,
  label,
  description,
  disabled,
  ...inputProps
}: {
  control: Control<TFieldValues>;
  name: TName;
  label: string;
  description?: string;
  disabled?: boolean;
} & Omit<ComponentProps<typeof PasswordInput>, "name" | "disabled">) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <PasswordInput {...field} {...inputProps} disabled={disabled} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
