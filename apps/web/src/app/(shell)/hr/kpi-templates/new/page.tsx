"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseCard } from "@/components/ui/card";
import {
  MasterDataForm,
  type MasterDataFormField,
} from "@/components/master-data/master-data-form";
import {
  KpiTemplateItemsEditor,
  EMPTY_KPI_TEMPLATE_ITEM,
  type KpiTemplateItemDraft,
} from "@/components/hr/kpi-template-items-editor";
import { kpiTemplatesService, type KpiTemplateItemInput } from "@/services/kpi-templates-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const templateSchema = z.object({
  name: z.string().min(1),
  nameEn: z.string().optional().or(z.literal("")),
  description: z.string().optional().or(z.literal("")),
});
type TemplateValues = z.infer<typeof templateSchema>;

function toItemInput(item: KpiTemplateItemDraft, index: number): KpiTemplateItemInput {
  return {
    id: item.id,
    criterionAr: item.criterionAr,
    criterionEn: item.criterionEn || undefined,
    weight: item.weight ?? 0,
    itemType: item.itemType,
    evaluatorSource: item.evaluatorSource,
    autoMetricSource:
      item.itemType === "AUTO_METRIC" ? item.autoMetricSource || undefined : undefined,
    dropdownOptions: item.itemType === "DROPDOWN" ? item.dropdownOptions : undefined,
    sortOrder: index,
    isActive: item.isActive,
  };
}

export default function NewKpiTemplatePage() {
  const { t } = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<KpiTemplateItemDraft[]>([{ ...EMPTY_KPI_TEMPLATE_ITEM }]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<TemplateValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: { name: "", nameEn: "", description: "" },
  });

  const templateFields: MasterDataFormField[] = [
    { name: "name", label: "hr.kpiTemplates.fields.name", type: "text", required: true },
    { name: "nameEn", label: "hr.kpiTemplates.fields.nameEn", type: "text" },
    {
      name: "description",
      label: "hr.kpiTemplates.fields.description",
      type: "textarea",
      span: "full",
    },
  ];

  const submit = form.handleSubmit(async (values) => {
    setIsSubmitting(true);
    try {
      const created = await kpiTemplatesService.create({
        name: values.name,
        nameEn: values.nameEn || undefined,
        description: values.description || undefined,
        items: items.map(toItemInput),
      });
      toast.success(t("hr.kpiTemplates.toasts.saved"));
      router.push(`/hr/kpi-templates/${created.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsSubmitting(false);
    }
  });

  return (
    <PageWorkspace
      title={t("hr.kpiTemplates.addNew")}
      description={t("hr.kpiTemplates.description")}
    >
      <EnterpriseCard className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-5">
        <MasterDataForm
          form={form}
          fields={templateFields}
          sectionTitle={t("common.generalInformation")}
          columns={2}
        />

        <div className="flex flex-col gap-2">
          <p className="text-caption font-medium text-muted-foreground">
            {t("hr.kpiTemplates.items.title")}
          </p>
          <KpiTemplateItemsEditor items={items} onChange={setItems} />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <EnterpriseButton
            type="button"
            variant="ghost"
            onClick={() => router.push("/hr/kpi-templates")}
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton type="button" onClick={() => void submit()} disabled={isSubmitting}>
            {t("common.save")}
          </EnterpriseButton>
        </div>
      </EnterpriseCard>
    </PageWorkspace>
  );
}
