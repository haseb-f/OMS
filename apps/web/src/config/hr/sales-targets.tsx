"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { StackedCell } from "@/components/shared/stacked-cell";
import type { SalesTargetRow } from "@/services/sales-targets-service";
import type { MessageKey } from "@/i18n/translate";

export function formatTargetAmount(value: string | number) {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function salesTargetScopeLabel(row: SalesTargetRow): string {
  return row.scopeType === "EMPLOYEE"
    ? row.employeeProfile
      ? `${row.employeeProfile.employeeCode} — ${row.employeeProfile.partner.name}`
      : "—"
    : (row.salesTeam?.name ?? "—");
}

function SalesTargetScopeCell({ row, t }: { row: SalesTargetRow; t: (key: MessageKey) => string }) {
  return (
    <StackedCell
      primary={salesTargetScopeLabel(row)}
      secondary={t(`hr.salesTargets.scopeType.${row.scopeType}` as MessageKey)}
    />
  );
}

export function buildSalesTargetsColumns(
  t: (key: MessageKey) => string,
): ColumnDef<SalesTargetRow, unknown>[] {
  return [
    {
      id: "period",
      meta: { titleKey: "hr.salesTargets.fields.period" },
      accessorFn: (row) => row.period,
      cell: (info) => <span dir="ltr">{info.getValue() as string}</span>,
    },
    {
      id: "scope",
      meta: { titleKey: "hr.salesTargets.fields.scopeType" },
      accessorFn: (row) => salesTargetScopeLabel(row),
      cell: ({ row }) => <SalesTargetScopeCell row={row.original} t={t} />,
    },
    {
      id: "metric",
      meta: { titleKey: "hr.salesTargets.fields.metric" },
      accessorFn: (row) => t(`hr.salesTargets.metric.${row.metric}` as MessageKey),
      cell: (info) => info.getValue() as string,
    },
    {
      id: "targetAmount",
      meta: { titleKey: "hr.salesTargets.fields.targetAmount", align: "end" },
      accessorFn: (row) => formatTargetAmount(row.targetAmount),
      cell: (info) => info.getValue() as string,
    },
  ];
}

export const salesTargetRowLabel = (row: SalesTargetRow) =>
  `${row.period} — ${salesTargetScopeLabel(row)}`;
