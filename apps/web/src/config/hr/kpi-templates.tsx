"use client";

import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { StackedCell } from "@/components/shared/stacked-cell";
import { statusColumn } from "@/config/master-data/shared-columns";
import type { KpiTemplateRow } from "@/services/kpi-templates-service";

function TemplateNameCell({ row }: { row: KpiTemplateRow }) {
  return <StackedCell primary={row.name} secondary={row.nameEn} />;
}

export function buildKpiTemplatesColumns(): ColumnDef<KpiTemplateRow, unknown>[] {
  return [
    {
      id: "name",
      meta: { titleKey: "hr.kpiTemplates.fields.name" },
      accessorFn: (row) => row.name,
      cell: ({ row }) => <TemplateNameCell row={row.original} />,
    },
    {
      id: "description",
      meta: { titleKey: "hr.kpiTemplates.fields.description" },
      accessorFn: (row) => row.description ?? "—",
      cell: (info) => info.getValue() as string,
    },
    {
      id: "itemsCount",
      meta: { titleKey: "hr.kpiTemplates.items.title" },
      accessorFn: (row) => row.items?.length ?? 0,
      cell: (info) => info.getValue() as number,
      enableSorting: false,
    },
    statusColumn<KpiTemplateRow>(),
  ];
}

export const kpiTemplatesExportColumns = ["name", "nameEn", "description"];

export const kpiTemplateRowLabel = (row: KpiTemplateRow) => row.name;

/** List page's built-in quick-edit modal — basic fields only. `items`/`assignments` are edited on the dedicated editor page (nested items + weight validation can't be expressed through the generic Master Data modal). */
export const kpiTemplateUpdateSchema = z.object({
  name: z.string().min(1),
  nameEn: z.string().optional().or(z.literal("")),
  description: z.string().optional().or(z.literal("")),
});

export const kpiTemplateUpdateDefaultValues = {
  name: "",
  nameEn: "",
  description: "",
};
