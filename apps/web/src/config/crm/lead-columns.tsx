"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ClassificationBadge } from "@/components/business/classification-badge";
import { DynamicStatusBadge } from "@/components/business/dynamic-status-badge";
import { LocaleText } from "@/components/shared/locale-text";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { formatDisplayDate } from "@/lib/date";
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

  if (when >= startToday && when < startTomorrow) {
    return <span>{t("crm.leads.followUp.today")}</span>;
  }
  if (when >= startTomorrow && when < startDayAfter) {
    return <span>{t("crm.leads.followUp.tomorrow")}</span>;
  }
  if (overdue) {
    return <span className="text-destructive font-medium">{t("crm.leads.followUp.overdue")}</span>;
  }
  return <SemanticValue kind="date">{formatDisplayDate(value)}</SemanticValue>;
}

export const leadColumns: ColumnDef<LeadRow, unknown>[] = [
  {
    id: "leadNumber",
    meta: { titleKey: "crm.leads.fields.leadNumber", identity: true, type: "code" },
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
    meta: { titleKey: "crm.leads.fields.customerName", type: "name" },
    accessorFn: (row) => row.customerName,
    cell: ({ row }) => (
      <StackedCell
        primary={<LocaleText>{row.original.customerName}</LocaleText>}
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
    meta: { titleKey: "crm.leads.fields.mobileNumber", defaultHidden: true, type: "phone" },
    accessorFn: (row) => row.mobileNumber,
    cell: (info) => (
      <span title={String(info.getValue() ?? "")} className="inline-flex min-w-0 max-w-full">
        <SemanticValue kind="phone">{info.getValue() as string}</SemanticValue>
      </span>
    ),
  },
  {
    id: "country",
    meta: { titleKey: "crm.leads.fields.country", type: "name" },
    accessorFn: (row) => row.country?.name ?? "—",
  },
  {
    id: "classification",
    meta: { titleKey: "crm.leads.fields.classification", type: "status" },
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
    meta: { titleKey: "common.status", type: "status" },
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
    meta: { titleKey: "crm.leads.fields.source", type: "name" },
    accessorFn: (row) => row.source,
  },
  {
    id: "salesEmployee",
    meta: { titleKey: "crm.leads.fields.assignedTo", type: "name" },
    enableSorting: false,
    accessorFn: (row) => row.salesEmployee?.fullName ?? "—",
  },
  {
    id: "nextFollowUpAt",
    meta: { titleKey: "crm.leads.fields.nextFollowUp", type: "date" },
    cell: ({ row }) => <NextFollowUpCell value={row.original.nextFollowUpAt} />,
  },
  {
    id: "createdAt",
    meta: { titleKey: "crm.leads.fields.createdAt", type: "date" },
    accessorFn: (row) => formatDisplayDate(row.createdAt),
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
