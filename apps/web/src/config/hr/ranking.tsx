"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { StackedCell } from "@/components/shared/stacked-cell";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { formatTargetAmount } from "@/config/hr/sales-targets";
import type { RankingRow } from "@/services/sales-targets-service";
import type { MessageKey } from "@/i18n/translate";

function achievementTone(percent: number): StatusTone {
  if (percent >= 100) return "success";
  if (percent >= 75) return "info";
  if (percent >= 50) return "warning";
  return "destructive";
}

export function buildRankingColumns(
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
  total: number,
): ColumnDef<RankingRow, unknown>[] {
  return [
    {
      id: "rank",
      meta: { titleKey: "hr.ranking.rank", align: "center" },
      accessorFn: (row) => row.rank,
      cell: (info) => (
        <span className="font-semibold tabular-nums">
          #{info.getValue() as number} {t("hr.ranking.of", { total })}
        </span>
      ),
    },
    {
      id: "employee",
      meta: { titleKey: "hr.commissions.fields.employee" },
      accessorFn: (row) => row.name,
      cell: ({ row }) => (
        <StackedCell primary={row.original.name} secondary={row.original.employeeCode} />
      ),
    },
    {
      id: "targetAmount",
      meta: { titleKey: "hr.salesTargets.fields.targetAmount", align: "end" },
      accessorFn: (row) => formatTargetAmount(row.targetAmount),
      cell: (info) => info.getValue() as string,
    },
    {
      id: "actual",
      meta: { titleKey: "hr.salesTargets.fields.actualAmount", align: "end" },
      accessorFn: (row) => formatTargetAmount(row.actual),
      cell: (info) => info.getValue() as string,
    },
    {
      id: "achievementPercent",
      meta: { titleKey: "hr.salesTargets.fields.achievement", align: "end" },
      accessorFn: (row) => row.achievementPercent,
      cell: ({ row }) => {
        const percent = row.original.achievementPercent;
        return <StatusBadge label={`${percent.toFixed(1)}%`} tone={achievementTone(percent)} />;
      },
    },
  ];
}
