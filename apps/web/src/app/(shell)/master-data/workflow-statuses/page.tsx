"use client";

import { useMemo } from "react";
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
  type WorkflowStatusRow,
} from "@/config/master-data/workflow-statuses";
import { useLocale } from "@/providers/locale-provider";

const service = createMasterDataService<WorkflowStatusRow>("/status-definitions");

export default function WorkflowStatusesPage() {
  const { t } = useLocale();

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      {
        name: "workflowType",
        label: "masterData.workflowStatuses.workflowType",
        type: "select",
        required: true,
        options: [
          { value: "LEAD", label: "LEAD" },
          { value: "ORDER", label: "ORDER" },
          { value: "PAYMENT", label: "PAYMENT" },
          { value: "FULFILLMENT", label: "FULFILLMENT" },
          { value: "MATCHING", label: "MATCHING" },
          { value: "RECONCILIATION", label: "RECONCILIATION" },
        ],
      },
      {
        name: "code",
        label: "masterData.workflowStatuses.code",
        type: "text",
        required: true,
      },
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
      tableId="workflow-statuses"
      service={service}
      columns={workflowStatusesColumns}
      exportColumnKeys={workflowStatusesExportColumns}
      formFields={formFields}
      schema={workflowStatusesSchema}
      defaultValues={workflowStatusesDefaultValues}
      permissionPrefix="masterdata.workflow-statuses"
      rowLabel={workflowStatusRowLabel}
      defaultSortBy="sortOrder"
      isRowProtected={(row) => row.isSystem}
    />
  );
}
