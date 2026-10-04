"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { StackedCell } from "@/components/shared/stacked-cell";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { SemanticValue } from "@/components/shared/semantic-value";
import type { KpiEvaluationRow, KpiEvaluationStatus } from "@/services/kpi-evaluations-service";
import type { MessageKey } from "@/i18n/translate";
import { formatAmount } from "@/lib/money";

export const KPI_EVALUATION_STATUSES: KpiEvaluationStatus[] = [
  "DRAFT",
  "MANAGER_SUBMITTED",
  "HR_APPROVED",
  "INCLUDED_IN_PAYROLL",
];

export const kpiEvaluationStatusTone: Record<KpiEvaluationStatus, StatusTone> = {
  DRAFT: "neutral",
  MANAGER_SUBMITTED: "info",
  HR_APPROVED: "success",
  INCLUDED_IN_PAYROLL: "success",
};

function formatScoreAmount(value: string | null) {
  return value === null ? "—" : formatAmount(value);
}

function EmployeeCell({ row }: { row: KpiEvaluationRow }) {
  return (
    <StackedCell
      primary={row.employeeProfile.partner.name}
      secondary={row.employeeProfile.employeeCode}
    />
  );
}

function StatusCell({ row, t }: { row: KpiEvaluationRow; t: (key: MessageKey) => string }) {
  return (
    <StatusBadge
      label={t(`hr.kpiEvaluations.status.${row.status}` as MessageKey)}
      tone={kpiEvaluationStatusTone[row.status]}
    />
  );
}

export function buildKpiEvaluationsColumns(
  t: (key: MessageKey) => string,
  /** `KpiEvaluation` carries only a bare `kpiTemplateId` (see `KpiEvaluationsService.EVALUATION_INCLUDE` — no `kpiTemplate` relation include), so the list page resolves the friendly name itself via a small id -> name lookup. */
  templateNameById: Record<string, string>,
): ColumnDef<KpiEvaluationRow, unknown>[] {
  return [
    {
      id: "employee",
      meta: { titleKey: "hr.kpiEvaluations.fields.employee", type: "name" },
      accessorFn: (row) => row.employeeProfile.partner.name,
      cell: ({ row }) => <EmployeeCell row={row.original} />,
    },
    {
      id: "period",
      meta: { titleKey: "hr.kpiEvaluations.fields.period", type: "date" },
      accessorFn: (row) => row.period,
      cell: (info) => <SemanticValue kind="id">{info.getValue() as string}</SemanticValue>,
    },
    {
      id: "template",
      meta: { titleKey: "hr.kpiEvaluations.fields.template", type: "default" },
      accessorFn: (row) => templateNameById[row.kpiTemplateId] ?? "—",
      cell: (info) => info.getValue() as string,
      enableSorting: false,
    },
    {
      id: "status",
      meta: {
        titleKey: "hr.kpiEvaluations.fields.status",
        type: "status",
        displayValue: (row, tr) => tr(`hr.kpiEvaluations.status.${row.status}` as MessageKey),
      },
      accessorFn: (row) => row.status,
      cell: ({ row }) => <StatusCell row={row.original} t={t} />,
      enableSorting: false,
    },
    {
      id: "finalScore",
      meta: { titleKey: "hr.kpiEvaluations.fields.finalScore", type: "percent" },
      accessorFn: (row) =>
        row.finalScore === null ? "—" : `${formatScoreAmount(row.finalScore)}%`,
      cell: (info) => info.getValue() as string,
    },
    {
      id: "kpiPay",
      meta: { titleKey: "hr.kpiEvaluations.fields.kpiPay", type: "money" },
      accessorFn: (row) => formatScoreAmount(row.kpiPay),
      cell: (info) => <SemanticValue kind="money">{info.getValue() as string}</SemanticValue>,
    },
  ];
}

export const kpiEvaluationsExportColumns = [
  "employee",
  "period",
  "template",
  "status",
  "finalScore",
  "kpiPay",
];
