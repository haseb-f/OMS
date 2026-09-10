"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { EnterpriseButton } from "@/components/ui/button";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  kpiTemplatesService,
  type KpiTemplateRow,
  type CreateKpiTemplatePayload,
  type UpdateKpiTemplatePayload,
} from "@/services/kpi-templates-service";
import {
  buildKpiTemplatesColumns,
  kpiTemplatesExportColumns,
  kpiTemplateRowLabel,
  kpiTemplateUpdateSchema,
  kpiTemplateUpdateDefaultValues,
} from "@/config/hr/kpi-templates";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";

/**
 * Adapts `kpiTemplatesService`'s narrowly-typed DTOs to `MasterDataPage`'s
 * generic `Record<string, unknown>` service shape. Nested `items` (weighted
 * criteria) can't be expressed through the generic modal, so the built-in
 * Create/Edit here only ever touches name/nameEn/description — "+ New" and
 * every row's full edit (with items + assignments) go to the dedicated
 * editor page instead (`getRowHref` below).
 */
const listService = {
  ...kpiTemplatesService,
  create: (dto: Record<string, unknown>) =>
    kpiTemplatesService.create(dto as unknown as CreateKpiTemplatePayload),
  update: (id: string, dto: Record<string, unknown>) =>
    kpiTemplatesService.update(id, dto as UpdateKpiTemplatePayload),
  // The real endpoint only ever returns `{ id }` (see `KpiTemplatesService.archive`/`.restore`)
  // — `MasterDataPage` never reads the resolved value beyond satisfying its generic
  // `Promise<TEntity>` contract before it re-fetches the list, so this cast is safe.
  archive: (id: string) => kpiTemplatesService.archive(id) as unknown as Promise<KpiTemplateRow>,
  restore: (id: string) => kpiTemplatesService.restore(id) as unknown as Promise<KpiTemplateRow>,
};

export default function KpiTemplatesPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();

  const columns = useMemo(() => buildKpiTemplatesColumns(), []);

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      { name: "name", label: "hr.kpiTemplates.fields.name", type: "text", required: true },
      { name: "nameEn", label: "hr.kpiTemplates.fields.nameEn", type: "text" },
      { name: "description", label: "hr.kpiTemplates.fields.description", type: "textarea" },
    ],
    [],
  );

  return (
    <MasterDataPage<KpiTemplateRow>
      titleKey="hr.kpiTemplates.title"
      descriptionKey="hr.kpiTemplates.description"
      tableId="hr-kpi-templates"
      service={listService}
      columns={columns}
      exportColumnKeys={kpiTemplatesExportColumns}
      formFields={formFields}
      schema={kpiTemplateUpdateSchema}
      defaultValues={kpiTemplateUpdateDefaultValues}
      permissionPrefix="hr.kpi-templates"
      rowLabel={kpiTemplateRowLabel}
      defaultSortBy="sortOrder"
      defaultSortOrder="asc"
      hideCreateButton
      getRowHref={(row) => `/hr/kpi-templates/${row.id}`}
      extraActions={
        hasPermission("hr.kpi-templates.create") ? (
          <EnterpriseButton type="button" onClick={() => router.push("/hr/kpi-templates/new")}>
            <Plus />
            {t("hr.kpiTemplates.addNew")}
          </EnterpriseButton>
        ) : undefined
      }
    />
  );
}
