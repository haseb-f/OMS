"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { MasterDataForm } from "@/components/master-data/master-data-form";
import {
  partnersService,
  type PartnerRoleValue,
  type PartnerRow,
} from "@/services/partners-service";
import {
  buildPartnerQuickCreateSchema,
  partnerQuickCreateDefaultValues,
} from "@/config/partners/partner-form";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import type { MessageKey } from "@/i18n/translate";

const LABELS: Record<
  PartnerRoleValue,
  {
    title: MessageKey;
    description: MessageKey;
    nameLabel: MessageKey;
    success: MessageKey;
    reused: MessageKey;
  }
> = {
  CUSTOMER: {
    title: "sales.customers.quickCreate.title",
    description: "sales.customers.quickCreate.description",
    nameLabel: "sales.customers.fields.name",
    success: "sales.customers.quickCreate.success",
    reused: "sales.customers.quickCreate.reused",
  },
  SUPPLIER: {
    title: "purchasing.suppliers.quickCreate.title",
    description: "purchasing.suppliers.quickCreate.description",
    nameLabel: "purchasing.suppliers.fields.name",
    success: "purchasing.suppliers.quickCreate.success",
    reused: "purchasing.suppliers.quickCreate.reused",
  },
  EMPLOYEE: {
    title: "partners.quickCreate.title",
    description: "partners.quickCreate.description",
    nameLabel: "partners.fields.name",
    success: "partners.quickCreate.success",
    reused: "partners.quickCreate.reused",
  },
  OWNER: {
    title: "partners.quickCreate.title",
    description: "partners.quickCreate.description",
    nameLabel: "partners.fields.name",
    success: "partners.quickCreate.success",
    reused: "partners.quickCreate.reused",
  },
  OTHER: {
    title: "partners.quickCreate.title",
    description: "partners.quickCreate.description",
    nameLabel: "partners.fields.name",
    success: "partners.quickCreate.success",
    reused: "partners.quickCreate.reused",
  },
};

/**
 * Unified Partner Architecture — one Quick Create dialog for every role
 * (replaces `CustomerQuickCreateDialog`/`SupplierQuickCreateDialog`). Calls
 * `findOrCreateWithRole`: if the phone/email typed already matches an
 * existing Partner, that Partner is reused and gains `role` if it doesn't
 * already hold it — never a duplicate identity (spec section 39).
 */
export function PartnerQuickCreateDialog({
  role,
  open,
  onOpenChange,
  onCreated,
}: {
  role: PartnerRoleValue;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (partner: PartnerRow) => void;
}) {
  const { t } = useLocale();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const quickCreateSchema = useMemo(() => buildPartnerQuickCreateSchema(t), [t]);
  const labels = LABELS[role];

  const form = useForm({
    resolver: zodResolver(quickCreateSchema),
    defaultValues: partnerQuickCreateDefaultValues,
  });

  useEffect(() => {
    if (open) form.reset(partnerQuickCreateDefaultValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    setIsSubmitting(true);
    try {
      const { partner, created } = await partnersService.findOrCreateWithRole(role, values);
      toast.success(t(created ? labels.success : labels.reused));
      onCreated(partner);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  });

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t(labels.title)}
      description={t(labels.description)}
      isDirty={form.formState.isDirty}
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
          <EnterpriseButton type="button" onClick={submit} disabled={isSubmitting}>
            {t("common.save")}
          </EnterpriseButton>
        </>
      )}
    >
      <MasterDataForm
        form={form}
        sectionTitle={t(labels.title)}
        columns={2}
        fields={[
          { name: "name", label: labels.nameLabel, type: "text", required: true },
          { name: "phone", label: "partners.fields.phone", type: "phone" },
          { name: "email", label: "partners.fields.email", type: "text" },
        ]}
      />
    </EnterpriseModal>
  );
}
