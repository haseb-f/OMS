"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { MasterDataForm } from "@/components/master-data/master-data-form";
import { customersService, type CustomerRow } from "@/services/customers-service";
import {
  buildCustomerQuickCreateSchema,
  customerQuickCreateDefaultValues,
} from "@/config/sales/customer-form";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

/**
 * Sales Foundation (TASK-038) — creates a Customer without leaving the
 * current screen (the `CustomerPicker`'s "+ Quick Create" action). Calls
 * `findOrCreate`, not `create`: if the phone/email the rep typed already
 * matches an existing customer, that existing record is selected instead
 * of a duplicate being created — "Never duplicate this component" applies
 * to the data, not just the UI.
 */
export function CustomerQuickCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (customer: CustomerRow) => void;
}) {
  const { t } = useLocale();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const quickCreateSchema = useMemo(() => buildCustomerQuickCreateSchema(t), [t]);

  const form = useForm({
    resolver: zodResolver(quickCreateSchema),
    defaultValues: customerQuickCreateDefaultValues,
  });

  useEffect(() => {
    if (open) form.reset(customerQuickCreateDefaultValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    setIsSubmitting(true);
    try {
      const { customer, created } = await customersService.findOrCreate(values);
      toast.success(
        created
          ? t("sales.customers.quickCreate.success")
          : t("sales.customers.quickCreate.reused"),
      );
      onCreated(customer);
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
      title={t("sales.customers.quickCreate.title")}
      description={t("sales.customers.quickCreate.description")}
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
        sectionTitle={t("sales.customers.quickCreate.title")}
        columns={2}
        fields={[
          { name: "name", label: "sales.customers.fields.name", type: "text", required: true },
          { name: "phone", label: "sales.customers.fields.phone", type: "phone" },
          { name: "email", label: "sales.customers.fields.email", type: "text" },
        ]}
      />
    </EnterpriseModal>
  );
}
