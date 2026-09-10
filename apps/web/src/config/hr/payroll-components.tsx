"use client";

import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { StackedCell } from "@/components/shared/stacked-cell";
import { StatusBadge } from "@/components/business/status-badge";
import { statusColumn } from "@/config/master-data/shared-columns";
import type { PayrollComponentRow } from "@/services/payroll-components-service";
import type { MessageKey } from "@/i18n/translate";

function PayrollComponentNameCell({ row }: { row: PayrollComponentRow }) {
  return <StackedCell primary={row.nameAr} secondary={row.nameEn} />;
}

function PayrollComponentTypeCell({
  row,
  t,
}: {
  row: PayrollComponentRow;
  t: (key: MessageKey) => string;
}) {
  return (
    <StatusBadge
      label={t(`hr.payrollComponents.type.${row.type}` as MessageKey)}
      tone={row.type === "EARNING" ? "success" : "destructive"}
    />
  );
}

export function buildPayrollComponentsColumns(
  t: (key: MessageKey) => string,
): ColumnDef<PayrollComponentRow, unknown>[] {
  return [
    {
      id: "nameAr",
      meta: { titleKey: "hr.payrollComponents.fields.nameAr" },
      accessorFn: (row) => row.nameAr,
      cell: ({ row }) => <PayrollComponentNameCell row={row.original} />,
    },
    {
      id: "type",
      meta: { titleKey: "hr.payrollComponents.fields.type" },
      accessorFn: (row) => row.type,
      cell: ({ row }) => <PayrollComponentTypeCell row={row.original} t={t} />,
      enableSorting: false,
    },
    {
      id: "calculationType",
      meta: { titleKey: "hr.payrollComponents.fields.calculationType" },
      accessorFn: (row) =>
        t(`hr.payrollComponents.calculationType.${row.calculationType}` as MessageKey),
      cell: (info) => info.getValue() as string,
    },
    {
      id: "defaultValue",
      meta: { titleKey: "hr.payrollComponents.fields.defaultValue" },
      accessorFn: (row) => (row.defaultValue != null ? Number(row.defaultValue) : ""),
      cell: (info) => {
        const value = info.getValue() as number | "";
        return value === "" ? "—" : value.toLocaleString();
      },
    },
    {
      id: "sortOrder",
      meta: { titleKey: "masterData.fields.sortOrder", defaultHidden: true },
      accessorFn: (row) => row.sortOrder,
      cell: (info) => String(info.getValue()),
    },
    statusColumn<PayrollComponentRow>(),
  ];
}

export const payrollComponentsExportColumns = [
  "nameAr",
  "nameEn",
  "type",
  "calculationType",
  "sortOrder",
];

export const payrollComponentRowLabel = (row: PayrollComponentRow) => row.nameAr;

export const payrollComponentsSchema = z.object({
  nameAr: z.string().min(1),
  nameEn: z.string().optional().or(z.literal("")),
  type: z.enum(["EARNING", "DEDUCTION"]),
  calculationType: z.enum(["FIXED", "PERCENTAGE", "VARIABLE"]),
  defaultValue: z.coerce.number().optional(),
  accountingMappingAccountId: z.string().optional().or(z.literal("")),
  sortOrder: z.coerce.number().optional(),
  isActive: z.boolean().optional(),
});

export const payrollComponentsDefaultValues = {
  nameAr: "",
  nameEn: "",
  type: "EARNING" as const,
  calculationType: "FIXED" as const,
  defaultValue: undefined,
  accountingMappingAccountId: "",
  sortOrder: 0,
  isActive: true,
};
