"use client";

import * as React from "react";
import { Slot } from "radix-ui";
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";

import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/providers/locale-provider";

const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ ...props }: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

function useFormField() {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: fieldContext.name });
  const fieldState = getFieldState(fieldContext.name, formState);

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>");
  }

  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
}

type FormItemContextValue = {
  id: string;
};

const FormItemContext = React.createContext<FormItemContextValue>({} as FormItemContextValue);

function FormItem({ className, ...props }: React.ComponentProps<"div">) {
  const id = React.useId();

  return (
    <FormItemContext.Provider value={{ id }}>
      <div data-slot="form-item" className={cn("grid gap-1.5", className)} {...props} />
    </FormItemContext.Provider>
  );
}

function FieldLabel({
  className,
  required,
  optional,
  error,
  children,
  ...props
}: React.ComponentProps<typeof Label> & {
  required?: boolean;
  optional?: boolean;
  error?: boolean;
}) {
  const { t } = useLocale();

  return (
    <Label
      data-slot="field-label"
      data-error={!!error}
      className={cn("gap-1 text-caption font-medium data-[error=true]:text-destructive", className)}
      {...props}
    >
      {children}
      {required ? (
        <span className="text-muted-foreground" aria-hidden="true">
          *
        </span>
      ) : optional ? (
        <span className="font-normal text-muted-foreground">{t("common.optional")}</span>
      ) : null}
    </Label>
  );
}

function FormLabel({
  className,
  required,
  optional,
  children,
  ...props
}: React.ComponentProps<typeof Label> & { required?: boolean; optional?: boolean }) {
  const { error, formItemId } = useFormField();

  return (
    <FieldLabel
      data-slot="form-label"
      htmlFor={formItemId}
      error={!!error}
      required={required}
      optional={optional}
      className={className}
      {...props}
    >
      {children}
    </FieldLabel>
  );
}

function FormControl({ ...props }: React.ComponentProps<typeof Slot.Root>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();

  return (
    <Slot.Root
      data-slot="form-control"
      id={formItemId}
      aria-describedby={!error ? `${formDescriptionId}` : `${formDescriptionId} ${formMessageId}`}
      aria-invalid={!!error}
      {...props}
    />
  );
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField();

  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn("text-caption text-muted-foreground", className)}
      {...props}
    />
  );
}

function FieldMessage({ className, children, ...props }: React.ComponentProps<"p">) {
  if (!children) {
    return null;
  }

  return (
    <p
      data-slot="field-message"
      role="alert"
      className={cn("flex items-start gap-1 text-caption font-medium text-destructive", className)}
      {...props}
    >
      <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function FormMessage({ className, ...props }: React.ComponentProps<"p">) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error?.message ?? "") : props.children;

  if (!body) {
    return null;
  }

  return (
    <FieldMessage data-slot="form-message" id={formMessageId} className={className} {...props}>
      {body}
    </FieldMessage>
  );
}

export {
  useFormField,
  Form,
  FormItem,
  FieldLabel,
  FormLabel,
  FormControl,
  FormDescription,
  FieldMessage,
  FormMessage,
  FormField,
};
