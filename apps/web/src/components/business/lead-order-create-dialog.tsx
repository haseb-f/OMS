"use client";

import { useEffect, useMemo, useState } from "react";
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
import { productsService } from "@/services/products-service";
import { useCurrencies } from "@/hooks/use-reference-data";
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
  const currencies = useCurrencies();
  const [products, setProducts] = useState<{ id: string; displayName: string; sku: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    productsService
      .list({ pageSize: 200 })
      .then((r) =>
        setProducts(r.items.map((p) => ({ id: p.id, displayName: p.displayName, sku: p.sku }))),
      )
      .catch(() => setProducts([]));
  }, [open]);

  const schema = useMemo(() => buildLeadOrderCreateSchema(countries, t), [countries, t]);

  const form = useForm<LeadOrderCreateFormValues>({
    resolver: zodResolver(schema),
    defaultValues: leadOrderCreateDefaultValues,
  });

  useEffect(() => {
    if (open) form.reset(leadOrderCreateDefaultValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const recordType = form.watch("recordType");
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

    if (recordType !== "ORDER") return [base];

    return [
      {
        ...base,
        fields: [
          ...base.fields,
          { name: "address", label: "crm.leads.fields.address", type: "text", required: true },
          {
            name: "productId",
            label: "crm.leads.fields.product",
            type: "select",
            required: true,
            description: t("crm.leads.createDialog.productHelper"),
            options: products.map((p) => ({ value: p.id, label: `${p.displayName} (${p.sku})` })),
          },
          {
            name: "quantity",
            label: "crm.leads.fields.quantity",
            type: "number",
            description: t("crm.leads.createDialog.quantityHelper"),
          },
          {
            name: "paidAmount",
            label: "crm.leads.fields.paidAmount",
            type: "number",
            required: true,
            description: t("crm.leads.createDialog.paidAmountHelper"),
          },
          {
            name: "currencyId",
            label: "crm.leads.fields.currency",
            type: "select",
            description: t("crm.leads.createDialog.currencyHelper"),
            options: currencies.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
          },
          { name: "city", label: "crm.leads.fields.city", type: "text" },
          { name: "externalOrderId", label: "crm.leads.fields.externalOrderId", type: "text" },
        ],
      },
    ];
  }, [recordType, products, currencies, t]);

  const submit = form.handleSubmit(async (values) => {
    try {
      const payload = {
        ...values,
        city: values.city || undefined,
        address: values.address || undefined,
        productId: values.productId || undefined,
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
            {recordType === "ORDER"
              ? t("crm.leads.createDialog.saveAsOrder")
              : t("crm.leads.createDialog.saveAsLead")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-5">
        <div className="flex gap-2 rounded-md border border-border bg-muted/30 p-1">
          <EnterpriseButton
            type="button"
            variant={recordType === "LEAD" ? "default" : "ghost"}
            className="flex-1"
            onClick={() => form.setValue("recordType", "LEAD", { shouldDirty: true })}
          >
            {t("crm.leads.createDialog.modeLead")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            variant={recordType === "ORDER" ? "default" : "ghost"}
            className="flex-1"
            onClick={() => form.setValue("recordType", "ORDER", { shouldDirty: true })}
          >
            {t("crm.leads.createDialog.modeOrder")}
          </EnterpriseButton>
        </div>
        <p className="text-caption text-muted-foreground">
          {recordType === "ORDER"
            ? t("crm.leads.createDialog.modeOrderHint")
            : t("crm.leads.createDialog.modeLeadHint")}
        </p>
        <MasterDataForm form={form} sections={sections} countries={countries} />
      </div>
    </EnterpriseModal>
  );
}
