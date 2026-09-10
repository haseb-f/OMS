"use client";

import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { StackedCell } from "@/components/shared/stacked-cell";
import { StatusBadge } from "@/components/business/status-badge";
import { statusColumn } from "@/config/master-data/shared-columns";
import { formatDate } from "@/lib/date";
import type { EmployeeRow } from "@/services/employees-service";
import type { MessageKey } from "@/i18n/translate";

function EmployeeNameCell({ row }: { row: EmployeeRow }) {
  return <StackedCell primary={row.name} secondary={row.employeeCode} />;
}

function EmployeeWorkCell({ row }: { row: EmployeeRow }) {
  return <StackedCell primary={row.jobTitle?.name ?? "—"} secondary={row.department?.name} />;
}

const statusTone: Record<EmployeeRow["employmentStatus"], "success" | "neutral" | "destructive"> = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  TERMINATED: "destructive",
};

function EmploymentStatusCell({ row, t }: { row: EmployeeRow; t: (key: MessageKey) => string }) {
  return (
    <StatusBadge
      label={t(`hr.employees.status.${row.employmentStatus}` as MessageKey)}
      tone={statusTone[row.employmentStatus]}
    />
  );
}

export function buildEmployeesColumns(
  t: (key: MessageKey) => string,
): ColumnDef<EmployeeRow, unknown>[] {
  return [
    {
      id: "name",
      meta: { titleKey: "hr.employees.fields.name" },
      accessorFn: (row) => row.name,
      cell: ({ row }) => <EmployeeNameCell row={row.original} />,
    },
    {
      id: "work",
      meta: { titleKey: "hr.employees.fields.jobTitle" },
      accessorFn: (row) => row.jobTitle?.name ?? "",
      cell: ({ row }) => <EmployeeWorkCell row={row.original} />,
    },
    {
      id: "mobile",
      meta: { titleKey: "hr.employees.fields.mobile" },
      accessorFn: (row) => row.mobile ?? "—",
      cell: (info) => info.getValue() as string,
    },
    {
      id: "hireDate",
      meta: { titleKey: "hr.employees.fields.hireDate" },
      accessorFn: (row) => (row.hireDate ? formatDate(row.hireDate) : "—"),
      cell: (info) => info.getValue() as string,
    },
    {
      id: "employmentStatus",
      meta: { titleKey: "hr.employees.fields.employmentStatus" },
      accessorFn: (row) => row.employmentStatus,
      cell: ({ row }) => <EmploymentStatusCell row={row.original} t={t} />,
      enableSorting: false,
    },
    statusColumn<EmployeeRow>(),
  ];
}

export const employeesExportColumns = ["employeeCode", "name", "mobile", "hireDate"];

export const employeeRowLabel = (row: EmployeeRow) => `${row.employeeCode} — ${row.name}`;

/** Update path only (Step 1 + Step 2 fields) — Compensation/Account live on the Profile page's own tabs, never this modal. */
export const employeeUpdateSchema = z.object({
  name: z.string().min(1),
  mobile: z.string().optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  hireDate: z.string().optional().or(z.literal("")),
  employmentStatus: z.enum(["ACTIVE", "INACTIVE", "TERMINATED"]).optional(),
  departmentId: z.string().optional().or(z.literal("")),
  jobTitleId: z.string().optional().or(z.literal("")),
  salesTeamId: z.string().optional().or(z.literal("")),
  managerEmployeeId: z.string().optional().or(z.literal("")),
});

export const employeeUpdateDefaultValues = {
  name: "",
  mobile: "",
  email: "",
  hireDate: "",
  employmentStatus: "ACTIVE" as const,
  departmentId: "",
  jobTitleId: "",
  salesTeamId: "",
  managerEmployeeId: "",
};
