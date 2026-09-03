"use client";

import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { LucideIcon } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import {
  MasterDataForm,
  type MasterDataFormSection,
} from "@/components/master-data/master-data-form";
import type { PhoneCountryOption } from "@/components/shared/phone-country-selector";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
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

  useEffect(() => {
    if (open) form.reset(leadOrderCreateDefaultValues);
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

  const submit = form.handleSubmit(async (values) => {
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
      toast.success(t("common.save"));
      onOpenChange(false);
      onCreated(created);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    }
  });

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      icon={icon}
      title={t("crm.leads.createDialog.title")}
      description={t("crm.leads.createDialog.description")}
      isDirty={isDirty}
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
      <div className="flex flex-col gap-5">
        <p className="text-caption text-muted-foreground">
          {t("crm.leads.createDialog.modeLeadHint")}
        </p>
        <MasterDataForm form={form} sections={sections} countries={countries} />
      </div>
    </EnterpriseModal>
  );
}
