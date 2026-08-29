"use client";

import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { DynamicStatusBadge } from "@/components/business/dynamic-status-badge";
import { StackedCell } from "@/components/shared/stacked-cell";
import { statusColumn, textColumn } from "./shared-columns";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import { useLocale } from "@/providers/locale-provider";

export interface WorkflowStatusRow {
  id: string;
  workflowType: string;
  code: string;
  name: string;
  nameEn: string | null;
  color: string;
  sortOrder: number;
  isSystem: boolean;
  isFinal: boolean;
  isDefault: boolean;
  deletedAt: string | null;
}

function WorkflowStatusNameCell({ row }: { row: WorkflowStatusRow }) {
  const { t } = useLocale();
  const badges = [
    row.isDefault ? t("masterData.shippingStatuses.default") : null,
    row.isSystem ? t("masterData.workflowStatuses.system") : null,
    row.isFinal ? t("masterData.workflowStatuses.final") : null,
  ].filter(Boolean);
  return (
    <StackedCell
      primary={<DynamicStatusBadge label={row.name} colorKey={row.color} />}
      secondary={badges.length ? badges.join(" · ") : undefined}
    />
  );
}

export const workflowStatusesColumns: ColumnDef<WorkflowStatusRow, unknown>[] = [
  {
    id: "name",
    meta: { titleKey: "masterData.fields.name" },
    accessorFn: (row) => row.name,
    cell: ({ row }) => <WorkflowStatusNameCell row={row.original} />,
  },
  textColumn("workflowType", "masterData.workflowStatuses.workflowType", (r) => r.workflowType),
  textColumn("code", "masterData.workflowStatuses.code", (r) => r.code),
  statusColumn<WorkflowStatusRow>(),
];

export const workflowStatusesStaticFields: MasterDataFormField[] = [
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "nameEn", label: "masterData.fields.nameEn", type: "text" },
];

export const workflowStatusesSchema = z.object({
  workflowType: z.enum(["LEAD", "ORDER", "PAYMENT", "FULFILLMENT", "MATCHING", "RECONCILIATION"]),
  code: z.string().min(1),
  name: z.string().min(1),
  nameEn: z.string().optional().or(z.literal("")),
  color: z.enum(["neutral", "info", "warning", "success", "destructive"]),
  sortOrder: z.coerce.number().optional(),
});

export const workflowStatusesDefaultValues = {
  workflowType: "LEAD" as const,
  code: "",
  name: "",
  nameEn: "",
  color: "neutral" as const,
  sortOrder: 0,
};

export const workflowStatusesExportColumns = ["name", "workflowType", "code", "color"];
export const workflowStatusRowLabel = (row: WorkflowStatusRow) =>
  `${row.workflowType}:${row.code} — ${row.name}`;
