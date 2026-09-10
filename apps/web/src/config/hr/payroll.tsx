"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Wallet } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { StackedCell } from "@/components/shared/stacked-cell";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import type { PayrollRunRow, PayrollRunStatus, PayrollLineRow } from "@/services/payroll-service";
import type { MessageKey } from "@/i18n/translate";

/** Prisma `Decimal` values arrive serialized as strings — same formatting convention as `purchasing/suppliers/[id]/page.tsx`'s local helper. */
export function formatMoney(value: string | number) {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export const payrollRunStatusTone: Record<PayrollRunStatus, StatusTone> = {
  DRAFT: "neutral",
  HR_REVIEWED: "info",
  FINANCE_APPROVED: "warning",
  POSTED: "success",
  PAID: "success",
};

function MoneyCell({ value }: { value: string }) {
  return <span dir="ltr">{formatMoney(value)}</span>;
}

export function buildPayrollRunsColumns(
  t: (key: MessageKey) => string,
): ColumnDef<PayrollRunRow, unknown>[] {
  return [
    {
      id: "period",
      meta: { titleKey: "hr.payroll.fields.period" },
      accessorFn: (row) => row.period,
      cell: (info) => (
        <span dir="ltr" className="font-medium">
          {info.getValue() as string}
        </span>
      ),
    },
    {
      id: "status",
      meta: { titleKey: "hr.payroll.fields.status" },
      accessorFn: (row) => row.status,
      cell: ({ row }) => (
        <StatusBadge
          label={t(`hr.payroll.status.${row.original.status}` as MessageKey)}
          tone={payrollRunStatusTone[row.original.status]}
        />
      ),
      enableSorting: false,
    },
    {
      id: "grossEarnings",
      meta: { titleKey: "hr.payroll.fields.grossEarnings", align: "end" },
      accessorFn: (row) => Number(row.grossEarnings),
      cell: ({ row }) => <MoneyCell value={row.original.grossEarnings} />,
    },
    {
      id: "totalDeductions",
      meta: { titleKey: "hr.payroll.fields.totalDeductions", align: "end" },
      accessorFn: (row) => Number(row.totalDeductions),
      cell: ({ row }) => <MoneyCell value={row.original.totalDeductions} />,
    },
    {
      id: "netPay",
      meta: { titleKey: "hr.payroll.fields.netPay", align: "end" },
      accessorFn: (row) => Number(row.netPay),
      cell: ({ row }) => (
        <span dir="ltr" className="font-semibold">
          {formatMoney(row.original.netPay)}
        </span>
      ),
    },
  ];
}

export function buildPayrollLinesColumns(
  t: (key: MessageKey) => string,
  onBreakdown: (line: PayrollLineRow) => void,
): ColumnDef<PayrollLineRow, unknown>[] {
  return [
    {
      id: "employee",
      meta: { titleKey: "hr.payroll.lines.employee" },
      accessorFn: (row) => row.employeeProfile.partner.name,
      cell: ({ row }) => (
        <StackedCell
          primary={row.original.employeeProfile.partner.name}
          secondary={row.original.employeeProfile.employeeCode}
        />
      ),
    },
    {
      id: "basicSalary",
      meta: { titleKey: "hr.payroll.lines.basicSalary", align: "end" },
      accessorFn: (row) => Number(row.basicSalary),
      cell: ({ row }) => <MoneyCell value={row.original.basicSalary} />,
    },
    {
      id: "kpiPay",
      meta: { titleKey: "hr.payroll.lines.kpiPay", align: "end" },
      accessorFn: (row) => Number(row.kpiPay),
      cell: ({ row }) => <MoneyCell value={row.original.kpiPay} />,
    },
    {
      id: "commission",
      meta: { titleKey: "hr.payroll.lines.commission", align: "end" },
      accessorFn: (row) => Number(row.commission),
      cell: ({ row }) => <MoneyCell value={row.original.commission} />,
    },
    {
      id: "allowances",
      meta: { titleKey: "hr.payroll.lines.allowances", align: "end" },
      accessorFn: (row) => Number(row.allowances),
      cell: ({ row }) => <MoneyCell value={row.original.allowances} />,
    },
    {
      id: "otherEarnings",
      meta: { titleKey: "hr.payroll.lines.otherEarnings", align: "end", defaultHidden: true },
      accessorFn: (row) => Number(row.otherEarnings),
      cell: ({ row }) => <MoneyCell value={row.original.otherEarnings} />,
    },
    {
      id: "deductions",
      meta: { titleKey: "hr.payroll.lines.deductions", align: "end" },
      accessorFn: (row) => Number(row.deductions),
      cell: ({ row }) => (
        <span dir="ltr" className="text-destructive">
          {formatMoney(row.original.deductions)}
        </span>
      ),
    },
    {
      id: "grossEarnings",
      meta: { titleKey: "hr.payroll.lines.grossEarnings", align: "end" },
      accessorFn: (row) => Number(row.grossEarnings),
      cell: ({ row }) => (
        <span dir="ltr" className="font-medium">
          {formatMoney(row.original.grossEarnings)}
        </span>
      ),
    },
    {
      id: "netPay",
      meta: { titleKey: "hr.payroll.lines.netPay", align: "end" },
      accessorFn: (row) => Number(row.netPay),
      cell: ({ row }) => (
        <span dir="ltr" className="font-semibold">
          {formatMoney(row.original.netPay)}
        </span>
      ),
    },
    {
      id: "breakdown",
      meta: { titleKey: "hr.payroll.lines.breakdown", align: "center" },
      accessorFn: () => "",
      enableSorting: false,
      cell: ({ row }) => (
        <EnterpriseButton
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("hr.payroll.lines.breakdown")}
          onClick={(event) => {
            event.stopPropagation();
            onBreakdown(row.original);
          }}
        >
          <Wallet className="size-4" />
        </EnterpriseButton>
      ),
    },
  ];
}

export const payrollLinesExportColumns = [
  "employee",
  "basicSalary",
  "kpiPay",
  "commission",
  "allowances",
  "deductions",
  "grossEarnings",
  "netPay",
];
