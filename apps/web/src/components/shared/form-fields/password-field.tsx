"use client";

import { useState } from "react";
import type { ComponentProps } from "react";
import type { Control, FieldPath, FieldValues } from "react-hook-form";
import { Eye, EyeOff } from "lucide-react";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

/**
 * Password input with an LTR value (cursor and characters) and an RTL label.
 * The visibility toggle sits in a local `dir="ltr"` wrapper so padding-end
 * and the icon stay on the same side in an RTL page — matching DatePicker.
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
  className,
  ...inputProps
}: {
  control: Control<TFieldValues>;
  name: TName;
  label: string;
  description?: string;
  disabled?: boolean;
} & Omit<ComponentProps<typeof Input>, "name" | "disabled" | "type">) {
  const { t } = useLocale();
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? t("auth.hidePassword") : t("auth.showPassword");

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className="relative" dir="ltr">
            <FormControl>
              <Input
                {...field}
                {...inputProps}
                dir="ltr"
                type={visible ? "text" : "password"}
                disabled={disabled}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="none"
                className={cn("pe-10", className)}
              />
            </FormControl>
            <div className="absolute inset-y-0 end-0 flex items-center pe-1">
              <IconActionButton
                label={toggleLabel}
                disabled={disabled}
                pressed={visible}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setVisible((current) => !current)}
              >
                {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </IconActionButton>
            </div>
          </div>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
