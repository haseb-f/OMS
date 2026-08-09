"use client";

import type { FieldValues, UseFormReturn } from "react-hook-form";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModalSection, ModalFieldFullWidth } from "@/components/shared/modal-section";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";

export interface MasterDataFormField {
  name: string;
  /** An i18n key, not literal text — Arabic is the default locale (see nav.config.ts convention). */
  label: MessageKey;
  type: "text" | "textarea" | "number" | "select" | "boolean";
  required?: boolean;
  placeholder?: string;
  /** Pre-resolved display text (translated or a raw entity name) — the page builds this via `t()`/live data, not a MessageKey itself. */
  options?: { value: string; label: string }[];
  description?: string;
}

export interface MasterDataFormSection {
  title: string;
  columns?: 2 | 3;
  fields: MasterDataFormField[];
}

function FormFieldGrid<TFieldValues extends FieldValues>({
  form,
  fields,
}: {
  form: UseFormReturn<TFieldValues>;
  fields: MasterDataFormField[];
}) {
  const { t } = useLocale();

  return (
    <>
      {fields.map((field) => {
        const fieldNode = (
          <FormField
            control={form.control}
            name={field.name as never}
            render={({ field: rhfField }) =>
              field.type === "boolean" ? (
                <FormItem className="flex flex-row items-center gap-2 self-end pb-2.5">
                  <FormControl>
                    <Checkbox checked={!!rhfField.value} onCheckedChange={rhfField.onChange} />
                  </FormControl>
                  <FormLabel className="!mt-0">{t(field.label)}</FormLabel>
                </FormItem>
              ) : (
                <FormItem>
                  <FormLabel>
                    {t(field.label)}
                    {field.required && <span className="text-destructive"> *</span>}
                  </FormLabel>
                  <FormControl>
                    {field.type === "textarea" ? (
                      <Textarea
                        placeholder={field.placeholder}
                        {...rhfField}
                        value={rhfField.value ?? ""}
                      />
                    ) : field.type === "select" ? (
                      <Select value={rhfField.value ?? ""} onValueChange={rhfField.onChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={field.placeholder} />
                        </SelectTrigger>
                        <SelectContent>
                          {field.options?.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type={field.type === "number" ? "number" : "text"}
                        placeholder={field.placeholder}
                        {...rhfField}
                        value={rhfField.value ?? ""}
                        onChange={(event) =>
                          rhfField.onChange(
                            field.type === "number"
                              ? event.target.valueAsNumber
                              : event.target.value,
                          )
                        }
                      />
                    )}
                  </FormControl>
                  {field.description && (
                    <p className="text-caption text-muted-foreground">{field.description}</p>
                  )}
                  <FormMessage />
                </FormItem>
              )
            }
          />
        );
        return field.type === "textarea" ? (
          <ModalFieldFullWidth key={field.name}>{fieldNode}</ModalFieldFullWidth>
        ) : (
          <div key={field.name}>{fieldNode}</div>
        );
      })}
    </>
  );
}

/**
 * The field-grid body of every Master Data Create/Edit modal, rendered
 * inside an `EnterpriseModal`. Two modes, same underlying field-config
 * shape:
 *
 * - `fields`+`sectionTitle` (all 16 flat Master Data entities): one
 *   `ModalSection`, unchanged since this component's introduction.
 * - `sections` (richer modules like Customer, TASK-038): several stacked
 *   `ModalSection`s (General Information, Contact Information, Commercial
 *   Information, Addresses, Notes, ...), each with its own field list.
 *
 * Owns no form state itself — the page creates the `useForm()` instance so
 * its footer buttons (rendered in the modal's sticky footer, a sibling of
 * this component) can submit the same form.
 */
export function MasterDataForm<TFieldValues extends FieldValues>(
  props: {
    form: UseFormReturn<TFieldValues>;
  } & (
    | { fields: MasterDataFormField[]; sectionTitle: string; columns?: 2 | 3; sections?: never }
    | { sections: MasterDataFormSection[]; fields?: never; sectionTitle?: never; columns?: never }
  ),
) {
  const { form } = props;
  const sections: MasterDataFormSection[] = props.sections ?? [
    { title: props.sectionTitle, columns: props.columns ?? 2, fields: props.fields },
  ];

  return (
    <Form {...form}>
      <div className="flex flex-col gap-5">
        {sections.map((section) => (
          <ModalSection key={section.title} title={section.title} columns={section.columns ?? 2}>
            <FormFieldGrid form={form} fields={section.fields} />
          </ModalSection>
        ))}
      </div>
    </Form>
  );
}
