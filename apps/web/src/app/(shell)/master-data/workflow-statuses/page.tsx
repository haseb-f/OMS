"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  workflowStatusesColumns,
  workflowStatusesStaticFields,
  workflowStatusesSchema,
  workflowStatusesDefaultValues,
  workflowStatusesExportColumns,
  workflowStatusRowLabel,
  WORKFLOW_TYPES,
  type WorkflowStatusRow,
  type WorkflowTypeValue,
} from "@/config/master-data/workflow-statuses";
import { useLocale } from "@/providers/locale-provider";

const service = createMasterDataService<WorkflowStatusRow>("/status-definitions");

/** One workflow type's full status table — scoped via extraListParams, same pattern as Transaction Types' IN/OUT tabs. */
function WorkflowTypeStatusTab({ workflowType }: { workflowType: WorkflowTypeValue }) {
  const { t } = useLocale();

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      ...workflowStatusesStaticFields,
      {
        name: "color",
        label: "masterData.fields.color",
        type: "select",
        required: true,
        options: [
          { value: "neutral", label: t("masterData.colors.neutral") },
          { value: "info", label: t("masterData.colors.info") },
          { value: "warning", label: t("masterData.colors.warning") },
          { value: "success", label: t("masterData.colors.success") },
          { value: "destructive", label: t("masterData.colors.destructive") },
        ],
      },
      {
        name: "sortOrder",
        label: "masterData.fields.sortOrder",
        type: "number",
      },
    ],
    [t],
  );

  return (
    <MasterDataPage
      titleKey="masterData.workflowStatuses.title"
      descriptionKey="masterData.workflowStatuses.description"
      tableId={`workflow-statuses-${workflowType.toLowerCase()}`}
      service={service}
      columns={workflowStatusesColumns}
      exportColumnKeys={workflowStatusesExportColumns}
      formFields={formFields}
      schema={workflowStatusesSchema}
      defaultValues={workflowStatusesDefaultValues(workflowType)}
      permissionPrefix="masterdata.workflow-statuses"
      rowLabel={workflowStatusRowLabel}
      defaultSortBy="sortOrder"
      extraListParams={{ workflowType }}
      isRowProtected={(row) => row.isDefault}
    />
  );
}

export default function WorkflowStatusesPage() {
  const { t } = useLocale();
  const [counts, setCounts] = useState<Partial<Record<WorkflowTypeValue, number>>>({});

  const loadCounts = useCallback(() => {
    for (const workflowType of WORKFLOW_TYPES) {
      service
        .list({ workflowType, pageSize: 1 })
        .then((result) => setCounts((prev) => ({ ...prev, [workflowType]: result.total })))
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  return (
    <Tabs defaultValue="LEAD" className="flex flex-col gap-3" onValueChange={loadCounts}>
      <TabsList variant="line">
        {WORKFLOW_TYPES.map((workflowType) => (
          <TabsTrigger key={workflowType} value={workflowType} className="gap-1.5">
            {t(`masterData.workflowStatuses.types.${workflowType}`)}
            {counts[workflowType] !== undefined && (
              <span className="text-caption text-muted-foreground tabular-nums">
                {counts[workflowType]}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {WORKFLOW_TYPES.map((workflowType) => (
        <TabsContent key={workflowType} value={workflowType}>
          <WorkflowTypeStatusTab workflowType={workflowType} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
