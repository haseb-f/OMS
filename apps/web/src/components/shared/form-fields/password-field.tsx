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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

/**
 * Password input with an RTL-safe visibility toggle. Default is hidden.
 * The control is `type="button"` so it never submits the form or mutates the value.
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
          <div className="relative">
            <FormControl>
              <Input
                {...field}
                {...inputProps}
                type={visible ? "text" : "password"}
                disabled={disabled}
                spellCheck={false}
                className={cn("pe-10", className)}
              />
            </FormControl>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  tabIndex={0}
                  aria-label={toggleLabel}
                  aria-pressed={visible}
                  disabled={disabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setVisible((current) => !current)}
                  className="absolute end-1.5 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-[170ms] ease-(--ease-standard) hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
                >
                  {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{toggleLabel}</TooltipContent>
            </Tooltip>
          </div>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
