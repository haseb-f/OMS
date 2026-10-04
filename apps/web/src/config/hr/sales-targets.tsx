"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { StackedCell } from "@/components/shared/stacked-cell";
import type { SalesTargetRow } from "@/services/sales-targets-service";
import type { MessageKey } from "@/i18n/translate";
import { formatAmount } from "@/lib/money";

export function formatTargetAmount(value: string | number) {
  return formatAmount(value);
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
      meta: { titleKey: "hr.salesTargets.fields.period", type: "date" },
      accessorFn: (row) => row.period,
      cell: (info) => <span className="num">{info.getValue() as string}</span>,
    },
    {
      id: "scope",
      // The employee / team the target belongs to is the card title.
      meta: { titleKey: "hr.salesTargets.fields.scopeType", type: "name" },
      accessorFn: (row) => salesTargetScopeLabel(row),
      cell: ({ row }) => <SalesTargetScopeCell row={row.original} t={t} />,
    },
    {
      id: "metric",
      meta: { titleKey: "hr.salesTargets.fields.metric", type: "default" },
      accessorFn: (row) => t(`hr.salesTargets.metric.${row.metric}` as MessageKey),
      cell: (info) => info.getValue() as string,
    },
    {
      id: "targetAmount",
      meta: { titleKey: "hr.salesTargets.fields.targetAmount", align: "end", type: "money" },
      accessorFn: (row) => formatTargetAmount(row.targetAmount),
      cell: (info) => info.getValue() as string,
    },
  ];
}

export const salesTargetRowLabel = (row: SalesTargetRow) =>
  `${row.period} — ${salesTargetScopeLabel(row)}`;
