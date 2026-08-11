"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { MasterDataForm } from "@/components/master-data/master-data-form";
import { suppliersService, type SupplierRow } from "@/services/suppliers-service";
import {
  buildSupplierQuickCreateSchema,
  supplierQuickCreateDefaultValues,
} from "@/config/purchasing/supplier-form";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

/**
 * TASK-048 — mirrors `CustomerQuickCreateDialog` exactly. Calls
 * `findOrCreate`, not `create`: if the phone/email the buyer typed already
 * matches an existing supplier, that existing record is selected instead
 * of a duplicate being created.
 */
export function SupplierQuickCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (supplier: SupplierRow) => void;
}) {
  const { t } = useLocale();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const quickCreateSchema = useMemo(() => buildSupplierQuickCreateSchema(t), [t]);

  const form = useForm({
    resolver: zodResolver(quickCreateSchema),
    defaultValues: supplierQuickCreateDefaultValues,
  });

  useEffect(() => {
    if (open) form.reset(supplierQuickCreateDefaultValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    setIsSubmitting(true);
    try {
      const { supplier, created } = await suppliersService.findOrCreate(values);
      toast.success(
        created
          ? t("purchasing.suppliers.quickCreate.success")
          : t("purchasing.suppliers.quickCreate.reused"),
      );
      onCreated(supplier);
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
      title={t("purchasing.suppliers.quickCreate.title")}
      description={t("purchasing.suppliers.quickCreate.description")}
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
        sectionTitle={t("purchasing.suppliers.quickCreate.title")}
        columns={2}
        fields={[
          { name: "name", label: "purchasing.suppliers.fields.name", type: "text", required: true },
          { name: "phone", label: "purchasing.suppliers.fields.phone", type: "phone" },
          { name: "email", label: "purchasing.suppliers.fields.email", type: "text" },
        ]}
      />
    </EnterpriseModal>
  );
}
