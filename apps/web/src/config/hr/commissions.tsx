"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Eye } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { StackedCell } from "@/components/shared/stacked-cell";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { formatMoney } from "@/lib/money";
import type { CommissionCalculationRow, CommissionStatus } from "@/services/commissions-service";
import type { MessageKey } from "@/i18n/translate";

/** Part T-X — Commission Calculation review list. Mirrors `config/hr/payroll.tsx`'s column-builder convention. */
export const commissionStatusTone: Record<CommissionStatus, StatusTone> = {
  CALCULATED: "neutral",
  APPROVED: "success",
  INCLUDED_IN_PAYROLL: "info",
  ADJUSTED: "warning",
};

function MoneyCell({ value }: { value: string }) {
  return <span dir="ltr">{formatMoney(value)}</span>;
}

/** The row's "view breakdown" control - shared by the table's detail column and the Grid card. */
export function CommissionDetailButton({
  row,
  label,
  onOpenDetail,
}: {
  row: CommissionCalculationRow;
  label: string;
  onOpenDetail: (row: CommissionCalculationRow) => void;
}) {
  return (
    <EnterpriseButton
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onOpenDetail(row);
      }}
    >
      <Eye className="size-4" />
    </EnterpriseButton>
  );
}

export function buildCommissionsColumns(
  t: (key: MessageKey) => string,
  onOpenDetail: (row: CommissionCalculationRow) => void,
): ColumnDef<CommissionCalculationRow, unknown>[] {
  return [
    {
      id: "employee",
      meta: { titleKey: "hr.commissions.fields.employee", type: "name" },
      accessorFn: (row) => row.employeeProfile.partner.name,
      cell: ({ row }) => (
        <StackedCell
          primary={row.original.employeeProfile.partner.name}
          secondary={row.original.employeeProfile.employeeCode}
        />
      ),
    },
    {
      id: "period",
      meta: { titleKey: "hr.commissions.fields.period", type: "date" },
      accessorFn: (row) => row.period,
      cell: (info) => (
        <span dir="ltr" className="font-medium">
          {info.getValue() as string}
        </span>
      ),
    },
    {
      id: "plan",
      meta: { titleKey: "hr.commissions.fields.plan", type: "default" },
      accessorFn: (row) => row.commissionPlan?.name ?? "",
      cell: (info) => (info.getValue() as string) || "—",
    },
    {
      id: "basisAmount",
      meta: { titleKey: "hr.commissions.fields.basisAmount", align: "end", type: "money" },
      accessorFn: (row) => Number(row.basisAmount),
      cell: ({ row }) => <MoneyCell value={row.original.basisAmount} />,
    },
    {
      id: "targetAmount",
      meta: { titleKey: "hr.commissions.fields.targetAmount", align: "end", type: "money" },
      accessorFn: (row) => (row.targetAmount ? Number(row.targetAmount) : 0),
      cell: ({ row }) =>
        row.original.targetAmount ? (
          <MoneyCell value={row.original.targetAmount} />
        ) : (
          <span>—</span>
        ),
    },
    {
      id: "achievementPercent",
      meta: { titleKey: "hr.commissions.fields.achievementPercent", align: "end", type: "percent" },
      accessorFn: (row) => (row.achievementPercent ? Number(row.achievementPercent) : 0),
      cell: ({ row }) =>
        row.original.achievementPercent ? (
          <span dir="ltr">{Number(row.original.achievementPercent).toFixed(1)}%</span>
        ) : (
          <span>—</span>
        ),
    },
    {
      id: "amount",
      meta: { titleKey: "hr.commissions.fields.amount", align: "end", type: "money" },
      accessorFn: (row) => Number(row.amount),
      cell: ({ row }) => (
        <span dir="ltr" className="font-semibold">
          {formatMoney(row.original.amount)}
        </span>
      ),
    },
    {
      id: "status",
      meta: {
        titleKey: "hr.commissions.fields.status",
        type: "status",
        displayValue: (row, tr) => tr(`hr.commissions.status.${row.status}` as MessageKey),
      },
      accessorFn: (row) => row.status,
      enableSorting: false,
      cell: ({ row }) => (
        <StatusBadge
          label={t(`hr.commissions.status.${row.original.status}` as MessageKey)}
          tone={commissionStatusTone[row.original.status]}
        />
      ),
    },
    {
      id: "detail",
      meta: { titleKey: "common.view", align: "center" },
      accessorFn: () => "",
      enableSorting: false,
      cell: ({ row }) => (
        <CommissionDetailButton
          row={row.original}
          label={t("common.view")}
          onOpenDetail={onOpenDetail}
        />
      ),
    },
  ];
}

export const commissionsExportColumns = [
  "employee",
  "period",
  "plan",
  "basisAmount",
  "targetAmount",
  "achievementPercent",
  "amount",
  "status",
];

export const commissionRowLabel = (row: CommissionCalculationRow) =>
  `${row.employeeProfile.partner.name} — ${row.period}`;
