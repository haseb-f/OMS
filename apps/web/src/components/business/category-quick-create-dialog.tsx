"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { MasterDataForm } from "@/components/master-data/master-data-form";
import { createMasterDataService } from "@/services/master-data-service";
import type { CategoryRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const categoriesService = createMasterDataService<CategoryRow>("/product-categories");

const quickCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().or(z.literal("")),
});

const defaultValues = { name: "", description: "" };

/**
 * Mirrors `SupplierQuickCreateDialog`/`CustomerQuickCreateDialog` — lets a
 * Product form create a missing Category without leaving the page (Part
 * 11). Deliberately name-only in scope: the accounting overrides
 * (revenue/inventory/COGS/purchase account) stay editable later on the full
 * Category page, matching "hide unnecessary fields, progressive disclosure"
 * — nothing here requires them at creation.
 */
export function CategoryQuickCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (category: CategoryRow) => void;
}) {
  const { t } = useLocale();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm({
    resolver: zodResolver(quickCreateSchema),
    defaultValues,
  });

  useEffect(() => {
    if (open) form.reset(defaultValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    setIsSubmitting(true);
    try {
      const category = await categoriesService.create(values);
      toast.success(t("products.categoryQuickCreate.success"));
      onCreated(category);
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
      title={t("products.categoryQuickCreate.title")}
      description={t("products.categoryQuickCreate.description")}
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
        sectionTitle={t("products.categoryQuickCreate.title")}
        columns={2}
        fields={[
          {
            name: "name",
            label: "products.categoryQuickCreate.fields.name",
            type: "text",
            required: true,
          },
          {
            name: "description",
            label: "products.categoryQuickCreate.fields.description",
            type: "textarea",
          },
        ]}
      />
    </EnterpriseModal>
  );
}
