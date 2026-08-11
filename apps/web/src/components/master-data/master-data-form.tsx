"use client";

import type { ControllerRenderProps, FieldValues, UseFormReturn } from "react-hook-form";
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
import { Plus } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { ModalSection, ModalFieldFullWidth } from "@/components/shared/modal-section";
import {
  PhoneCountrySelector,
  type PhoneCountryOption,
} from "@/components/shared/phone-country-selector";
import { OMSPhoneInput } from "@/components/shared/phone-input";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";

export interface MasterDataFormField {
  name: string;
  /** An i18n key, not literal text — Arabic is the default locale (see nav.config.ts convention). */
  label: MessageKey;
  type: "text" | "textarea" | "number" | "date" | "select" | "boolean" | "country" | "phone";
  required?: boolean;
  placeholder?: string;
  /** Pre-resolved display text (translated or a raw entity name) — the page builds this via `t()`/live data, not a MessageKey itself. */
  options?: { value: string; label: string }[];
  description?: string;
  /**
   * `type: "phone"` only — the sibling field holding the selected
   * `Country.id`, resolved against the form's `countries` list to the ISO2
   * code `OMSPhoneInput` needs. Required for a "phone" field to do
   * country-aware validation instead of falling back to
   * international-format-only.
   */
  countryFieldName?: string;
  /**
   * `type: "select"` only — an inline "+ Add new" affordance next to the
   * dropdown (Part 11) so the user never has to abandon this form to create
   * the referenced record elsewhere. The page owns the actual quick-create
   * dialog/state; this just hands it a `selectNewId` callback so the newly
   * created record gets auto-selected here once the page's dialog succeeds.
   */
  quickCreate?: {
    label: MessageKey;
    onCreate: (selectNewId: (id: string) => void) => void;
  };
}

export interface MasterDataFormSection {
  title: string;
  columns?: 2 | 3;
  fields: MasterDataFormField[];
}

/** Resolves `field.countryFieldName`'s current value (a `Country.id`) to its ISO2 code via the shared `countries` list, and re-renders whenever that sibling field changes — a `"phone"` field's country context always tracks the form's own `"country"` field live. */
function PhoneFormField<TFieldValues extends FieldValues>({
  rhfField,
  form,
  field,
  countries,
}: {
  rhfField: ControllerRenderProps<TFieldValues, never>;
  form: UseFormReturn<TFieldValues>;
  field: MasterDataFormField;
  countries: PhoneCountryOption[];
}) {
  const countryId = field.countryFieldName
    ? (form.watch(field.countryFieldName as never) as unknown as string | undefined)
    : undefined;
  const countryCode = countries.find((c) => c.id === countryId)?.code ?? null;

  return (
    <OMSPhoneInput
      value={rhfField.value}
      onChange={rhfField.onChange}
      onBlur={rhfField.onBlur}
      countryCode={countryCode}
      placeholder={field.placeholder}
    />
  );
}

function FormFieldGrid<TFieldValues extends FieldValues>({
  form,
  fields,
  countries,
}: {
  form: UseFormReturn<TFieldValues>;
  fields: MasterDataFormField[];
  /** Required for any `"country"`/`"phone"` field in `fields` — the one shared list both draw from, so a "phone" field's country context always matches whatever the "country" field's own options are. */
  countries?: PhoneCountryOption[];
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
                      <div className="flex items-center gap-1.5">
                        <Select value={rhfField.value ?? ""} onValueChange={rhfField.onChange}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={field.placeholder} />
                          </SelectTrigger>
                          <SelectContent>
                            {field.options?.length ? (
                              field.options.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))
                            ) : (
                              <div className="px-2 py-3 text-center text-caption text-muted-foreground">
                                {t("common.noDataAvailable")}
                              </div>
                            )}
                          </SelectContent>
                        </Select>
                        {field.quickCreate && (
                          <EnterpriseButton
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            aria-label={t(field.quickCreate.label)}
                            title={t(field.quickCreate.label)}
                            onClick={() =>
                              field.quickCreate!.onCreate((id) => rhfField.onChange(id))
                            }
                          >
                            <Plus className="size-4" />
                          </EnterpriseButton>
                        )}
                      </div>
                    ) : field.type === "country" ? (
                      <PhoneCountrySelector
                        value={rhfField.value}
                        onChange={rhfField.onChange}
                        countries={countries ?? []}
                        placeholder={field.placeholder}
                      />
                    ) : field.type === "phone" ? (
                      <PhoneFormField
                        rhfField={rhfField}
                        form={form}
                        field={field}
                        countries={countries ?? []}
                      />
                    ) : (
                      <Input
                        type={
                          field.type === "number"
                            ? "number"
                            : field.type === "date"
                              ? "date"
                              : "text"
                        }
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
    /** Required when any field across the form is `"country"`/`"phone"`. */
    countries?: PhoneCountryOption[];
  } & (
    | { fields: MasterDataFormField[]; sectionTitle: string; columns?: 2 | 3; sections?: never }
    | { sections: MasterDataFormSection[]; fields?: never; sectionTitle?: never; columns?: never }
  ),
) {
  const { form, countries } = props;
  const sections: MasterDataFormSection[] = props.sections ?? [
    { title: props.sectionTitle, columns: props.columns ?? 2, fields: props.fields },
  ];

  return (
    <Form {...form}>
      <div className="flex flex-col gap-5">
        {sections.map((section) => (
          <ModalSection key={section.title} title={section.title} columns={section.columns ?? 2}>
            <FormFieldGrid form={form} fields={section.fields} countries={countries} />
          </ModalSection>
        ))}
      </div>
    </Form>
  );
}
