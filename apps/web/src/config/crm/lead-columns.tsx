"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ClassificationBadge } from "@/components/business/classification-badge";
import { DynamicStatusBadge } from "@/components/business/dynamic-status-badge";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { LeadRow } from "@/services/leads-service";

function NextFollowUpCell({ value }: { value: string | null }) {
  const { t } = useLocale();
  if (!value) return <span>—</span>;
  const when = new Date(value);
  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startTomorrow = new Date(startToday);
  startTomorrow.setDate(startTomorrow.getDate() + 1);
  const startDayAfter = new Date(startTomorrow);
  startDayAfter.setDate(startDayAfter.getDate() + 1);
  const overdue = when.getTime() < now.getTime();
  let label = formatDate(value);
  if (when >= startToday && when < startTomorrow) label = t("crm.leads.followUp.today");
  else if (when >= startTomorrow && when < startDayAfter) label = t("crm.leads.followUp.tomorrow");
  else if (overdue) label = t("crm.leads.followUp.overdue");
  return <span className={overdue ? "text-destructive font-medium" : undefined}>{label}</span>;
}

export const leadColumns: ColumnDef<LeadRow, unknown>[] = [
  {
    id: "leadNumber",
    meta: { titleKey: "crm.leads.fields.leadNumber", identity: true },
    accessorFn: (row) => row.leadNumber,
    cell: ({ row }) => (
      <span title={row.original.leadNumber} className="inline-flex min-w-0 max-w-full">
        <SemanticValue kind="id" className="text-body font-medium">
          {row.original.leadNumber}
        </SemanticValue>
      </span>
    ),
  },
  {
    id: "customerName",
    meta: { titleKey: "crm.leads.fields.customerName" },
    accessorFn: (row) => row.customerName,
    cell: ({ row }) => (
      <StackedCell
        primary={row.original.customerName}
        secondary={
          row.original.mobileNumber ? (
            <SemanticValue kind="phone">{row.original.mobileNumber}</SemanticValue>
          ) : undefined
        }
      />
    ),
  },
  {
    id: "mobileNumber",
    meta: { titleKey: "crm.leads.fields.mobileNumber", defaultHidden: true },
    accessorFn: (row) => row.mobileNumber,
    cell: (info) => (
      <span title={String(info.getValue() ?? "")} className="inline-flex min-w-0 max-w-full">
        <SemanticValue kind="phone">{info.getValue() as string}</SemanticValue>
      </span>
    ),
  },
  {
    id: "country",
    meta: { titleKey: "crm.leads.fields.country" },
    accessorFn: (row) => row.country?.name ?? "—",
  },
  {
    id: "classification",
    meta: { titleKey: "crm.leads.fields.classification" },
    enableSorting: false,
    cell: ({ row }) =>
      row.original.customerClassification ? (
        <ClassificationBadge
          label={row.original.customerClassification.name}
          color={row.original.customerClassification.color}
        />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "status",
    meta: { titleKey: "common.status" },
    enableSorting: false,
    cell: ({ row }) => (
      <DynamicStatusBadge
        label={row.original.status?.name ?? "—"}
        colorKey={row.original.status?.color}
      />
    ),
  },
  {
    id: "source",
    meta: { titleKey: "crm.leads.fields.source" },
    accessorFn: (row) => row.source,
  },
  {
    id: "salesEmployee",
    meta: { titleKey: "crm.leads.fields.assignedTo" },
    enableSorting: false,
    accessorFn: (row) => row.salesEmployee?.fullName ?? "—",
  },
  {
    id: "nextFollowUpAt",
    meta: { titleKey: "crm.leads.fields.nextFollowUp" },
    cell: ({ row }) => <NextFollowUpCell value={row.original.nextFollowUpAt} />,
  },
  {
    id: "createdAt",
    meta: { titleKey: "crm.leads.fields.createdAt" },
    accessorFn: (row) => formatDate(row.createdAt),
  },
];

export const leadExportColumns = [
  "leadNumber",
  "customerName",
  "mobileNumber",
  "quantity",
  "status",
  "salesEmployee",
  "nextFollowUpAt",
  "createdAt",
];

export const leadRowLabel = (row: LeadRow) => `${row.leadNumber} — ${row.customerName}`;
