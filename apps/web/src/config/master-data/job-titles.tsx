"use client";

import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { StackedCell } from "@/components/shared/stacked-cell";
import { statusColumn, textColumn } from "./shared-columns";

export interface JobTitleRow {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  description: string | null;
  departmentId: string | null;
  department?: { id: string; name: string } | null;
  sortOrder: number;
  isActive: boolean;
  deletedAt: string | null;
}

function JobTitleNameCell({ row }: { row: JobTitleRow }) {
  return <StackedCell primary={row.name} secondary={row.department?.name} />;
}

export const jobTitlesColumns: ColumnDef<JobTitleRow, unknown>[] = [
  {
    id: "name",
    meta: { titleKey: "masterData.fields.name" },
    accessorFn: (row) => row.name,
    cell: ({ row }) => <JobTitleNameCell row={row.original} />,
  },
  textColumn("code", "masterData.fields.code", (r) => r.code),
  textColumn("nameEn", "masterData.fields.nameEn", (r) => r.nameEn),
  textColumn("sortOrder", "masterData.fields.sortOrder", (r) => String(r.sortOrder)),
  statusColumn<JobTitleRow>(),
];

export const jobTitlesSchema = z.object({
  name: z.string().min(1),
  nameEn: z.string().optional().or(z.literal("")),
  description: z.string().optional().or(z.literal("")),
  departmentId: z.string().optional().or(z.literal("")),
  sortOrder: z.coerce.number().optional(),
  isActive: z.boolean().optional(),
});

export const jobTitlesDefaultValues = {
  name: "",
  nameEn: "",
  description: "",
  departmentId: "",
  sortOrder: 0,
  isActive: true,
};

export const jobTitlesExportColumns = ["code", "name", "nameEn", "sortOrder"];
export const jobTitleRowLabel = (row: JobTitleRow) => `${row.code} — ${row.name}`;
