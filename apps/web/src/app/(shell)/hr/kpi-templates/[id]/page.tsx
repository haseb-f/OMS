"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Archive, FileText, RotateCcw } from "lucide-react";
import { DetailSection, DetailWorkspace } from "@/components/shared/detail-workspace";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { RowActionsMenu } from "@/components/shared/data-table";
import { EnterpriseButton } from "@/components/ui/button";
import {
  MasterDataForm,
  type MasterDataFormField,
} from "@/components/master-data/master-data-form";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/business/status-badge";
import {
  KpiTemplateItemsEditor,
  type KpiTemplateItemDraft,
} from "@/components/hr/kpi-template-items-editor";
import { KpiTemplateAssignmentsPanel } from "@/components/hr/kpi-template-assignments-panel";
import {
  kpiTemplatesService,
  type KpiTemplateRow,
  type KpiTemplateItemInput,
  type KpiTemplateItemRow,
} from "@/services/kpi-templates-service";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const templateSchema = z.object({
  name: z.string().min(1),
  nameEn: z.string().optional().or(z.literal("")),
  description: z.string().optional().or(z.literal("")),
});
type TemplateValues = z.infer<typeof templateSchema>;

function toDraft(item: KpiTemplateItemRow): KpiTemplateItemDraft {
  return {
    id: item.id,
    criterionAr: item.criterionAr,
    criterionEn: item.criterionEn ?? "",
    weight: Number(item.weight),
    itemType: item.itemType,
    evaluatorSource: item.evaluatorSource,
    autoMetricSource: item.autoMetricSource ?? "",
    dropdownOptions: item.dropdownOptions ?? [],
    isActive: item.isActive,
  };
}

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

export default function KpiTemplateDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useLocale();
  const { hasPermission } = useUserContext();

  const canEdit = hasPermission("hr.kpi-templates.edit");
  const canArchive = hasPermission("hr.kpi-templates.archive");

  const [template, setTemplate] = useState<KpiTemplateRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [items, setItems] = useState<KpiTemplateItemDraft[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [isMutating, setIsMutating] = useState(false);

  useBreadcrumbLabel(template?.name ?? null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await kpiTemplatesService.get(params.id);
      setTemplate(data);
      setItems((data.items ?? []).map(toDraft));
    } catch {
      setTemplate(null);
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    // Fetch-on-dependency-change: the standard data-fetching effect pattern
    // (same as `MasterDataPage`) — setState happens inside `load`'s async
    // body, not synchronously in the effect itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const form = useForm<TemplateValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: { name: "", nameEn: "", description: "" },
  });

  useEffect(() => {
    if (!template) return;
    form.reset({
      name: template.name,
      nameEn: template.nameEn ?? "",
      description: template.description ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

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

  if (isLoading) {
    return <p className="text-caption text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!template) {
    return <EmptyState icon={FileText} title={t("common.noResults")} />;
  }

  const save = form.handleSubmit(async (values) => {
    setIsSaving(true);
    try {
      await kpiTemplatesService.update(template.id, {
        name: values.name,
        nameEn: values.nameEn || undefined,
        description: values.description || undefined,
        items: items.map(toItemInput),
      });
      toast.success(t("hr.kpiTemplates.toasts.saved"));
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  });

  const confirmArchive = async () => {
    setIsMutating(true);
    try {
      await kpiTemplatesService.archive(template.id);
      toast.success(t("common.archive"));
      setArchiveOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsMutating(false);
    }
  };

  const confirmRestore = async () => {
    setIsMutating(true);
    try {
      await kpiTemplatesService.restore(template.id);
      toast.success(t("common.restore"));
      setRestoreOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <DetailWorkspace
      title={template.name}
      subtitle={template.nameEn}
      status={
        <StatusBadge
          label={t(template.deletedAt ? "common.archived" : "common.active")}
          tone={template.deletedAt ? "neutral" : "success"}
        />
      }
      actions={
        <RowActionsMenu
          label={t("common.actions")}
          actions={[
            {
              key: "archive",
              label: t("common.archive"),
              icon: Archive,
              hidden: !canArchive || !!template.deletedAt,
              destructive: true,
              onSelect: () => setArchiveOpen(true),
            },
            {
              key: "restore",
              label: t("common.restore"),
              icon: RotateCcw,
              hidden: !canArchive || !template.deletedAt,
              onSelect: () => setRestoreOpen(true),
            },
          ]}
        />
      }
    >
      <DetailSection title={t("common.generalInformation")}>
        <MasterDataForm form={form} fields={templateFields} sectionTitle="" columns={2} />
      </DetailSection>

      <DetailSection title={t("hr.kpiTemplates.items.title")}>
        <KpiTemplateItemsEditor items={items} onChange={setItems} />
      </DetailSection>

      <div className="flex items-center justify-end gap-2">
        <EnterpriseButton
          type="button"
          variant="ghost"
          onClick={() => router.push("/hr/kpi-templates")}
          disabled={isSaving}
        >
          {t("common.cancel")}
        </EnterpriseButton>
        <EnterpriseButton type="button" onClick={() => void save()} disabled={isSaving || !canEdit}>
          {t("common.save")}
        </EnterpriseButton>
      </div>

      <DetailSection title={t("hr.kpiTemplates.assignment.title")}>
        <KpiTemplateAssignmentsPanel
          templateId={template.id}
          assignments={template.assignments ?? []}
          onChanged={load}
        />
      </DetailSection>

      <ConfirmationDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        tone="destructive"
        title={t("common.confirmArchiveTitle")}
        description={t("common.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.cancel")}
        isConfirming={isMutating}
        onConfirm={() => void confirmArchive()}
      />
      <ConfirmationDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        title={t("common.confirmRestoreTitle")}
        description={t("common.confirmRestoreDescription")}
        confirmLabel={t("common.restore")}
        cancelLabel={t("common.cancel")}
        isConfirming={isMutating}
        onConfirm={() => void confirmRestore()}
      />
    </DetailWorkspace>
  );
}
