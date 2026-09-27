"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { LucideIcon } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import {
  FormErrorSummary,
  applyServerFieldErrors,
  formErrorsFromRhf,
  useFocusFirstInvalid,
  type FormErrorItem,
} from "@/components/shared/form-error-summary";
import {
  MasterDataForm,
  type MasterDataFormSection,
} from "@/components/master-data/master-data-form";
import type { PhoneCountryOption } from "@/components/shared/phone-country-selector";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, reportSuccess } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";

const FIELD_LABEL_KEY: Record<string, MessageKey> = {
  customerName: "crm.leads.fields.customerName",
  countryId: "crm.leads.fields.country",
  mobileNumber: "crm.leads.fields.mobileNumber",
};
const FIELD_ORDER = Object.keys(FIELD_LABEL_KEY);
import { leadsService, type LeadRow } from "@/services/leads-service";
import {
  buildLeadOrderCreateSchema,
  leadOrderCreateDefaultValues,
  type LeadOrderCreateFormValues,
} from "@/config/crm/lead-order-create-schema";

/**
 * The Lead/Order dual-mode create dialog (TASK-061 follow-up, Part 1) — a
 * dedicated, lean create surface separate from `MasterDataPage`'s own
 * modal (mirrors the `ProductCreateDialog` precedent), because Lead vs
 * Order validation is context-aware and can't live in one shared,
 * always-required field set. Lead mode: name/phone/country only. Order
 * mode: additionally address/product/paid amount — creates a linked
 * Payment record server-side in the same transaction.
 */
export function LeadOrderCreateDialog({
  open,
  onOpenChange,
  icon,
  countries,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon?: LucideIcon;
  countries: PhoneCountryOption[];
  onCreated: (lead: LeadRow) => void;
}) {
  const { t } = useLocale();

  const schema = useMemo(() => buildLeadOrderCreateSchema(countries, t), [countries, t]);

  const form = useForm<LeadOrderCreateFormValues>({
    resolver: zodResolver(schema),
    defaultValues: leadOrderCreateDefaultValues,
  });

  const bodyRef = useRef<HTMLDivElement>(null);
  const focusFirstInvalid = useFocusFirstInvalid(bodyRef);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FormErrorItem[]>([]);
  const labelFor = (name: string) => {
    const key = FIELD_LABEL_KEY[name];
    return key ? t(key) : undefined;
  };

  useEffect(() => {
    if (!open) return;
    form.reset(leadOrderCreateDefaultValues);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubmitAttempted(false);
    setServerErrors([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isDirty = form.formState.isDirty;
  const isSubmitting = form.formState.isSubmitting;

  const sections = useMemo<MasterDataFormSection[]>(() => {
    const base: MasterDataFormSection = {
      title: t("crm.leads.sections.general"),
      columns: 3,
      fields: [
        {
          name: "customerName",
          label: "crm.leads.fields.customerName",
          type: "text",
          required: true,
        },
        { name: "countryId", label: "crm.leads.fields.country", type: "country", required: true },
        {
          name: "mobileNumber",
          label: "crm.leads.fields.mobileNumber",
          type: "phone",
          required: true,
          countryFieldName: "countryId",
        },
      ],
    };

    return [base];
  }, [t]);

  // Field messages stay beside each field; the summary banner lists them and
  // focus moves once to the first invalid field (design-system §11.4).
  const summaryErrors: FormErrorItem[] = submitAttempted
    ? [
        ...formErrorsFromRhf(form.formState.errors, { labelFor, order: FIELD_ORDER }),
        ...serverErrors,
      ]
    : [];

  const onValid = async (values: LeadOrderCreateFormValues) => {
    try {
      const payload = {
        customerName: values.customerName,
        mobileNumber: values.mobileNumber,
        countryId: values.countryId,
        source: "MANUAL" as const,
        city: values.city || undefined,
        address: values.address || undefined,
        productId: values.productId || undefined,
        quantity: values.quantity,
        currencyId: values.currencyId || undefined,
        externalOrderId: values.externalOrderId || undefined,
        salesEmployeeId: values.salesEmployeeId || undefined,
      };
      const created = await leadsService.create(payload);
      setSubmitAttempted(false);
      reportSuccess(t("crm.leads.toasts.created"), { href: `/crm/leads/${created.id}` });
      onOpenChange(false);
      onCreated(created);
    } catch (error) {
      setServerErrors(
        applyServerFieldErrors(error, form.setError, {
          knownFields: FIELD_ORDER,
          labelFor,
          fallback: "common.failedToSave",
        }),
      );
      focusFirstInvalid();
      reportApiError(error, "common.failedToSave");
    }
  };

  const submit = () => {
    setSubmitAttempted(true);
    setServerErrors([]);
    return form.handleSubmit(onValid, () => focusFirstInvalid())();
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      icon={icon}
      title={t("crm.leads.createDialog.title")}
      description={t("crm.leads.createDialog.description")}
      isDirty={isDirty}
      errorSummary={<FormErrorSummary errors={summaryErrors} />}
      footer={(requestClose) => (
        <>
          <EnterpriseButton
            type="button"
            variant="ghost"
            onClick={requestClose}
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton type="button" onClick={() => submit()} disabled={isSubmitting}>
            {t("crm.leads.createDialog.saveAsLead")}
          </EnterpriseButton>
        </>
      )}
    >
      <div ref={bodyRef} className="flex flex-col gap-3">
        <p className="text-caption text-muted-foreground">
          {t("crm.leads.createDialog.modeLeadHint")}
        </p>
        <MasterDataForm form={form} sections={sections} countries={countries} />
      </div>
    </EnterpriseModal>
  );
}
