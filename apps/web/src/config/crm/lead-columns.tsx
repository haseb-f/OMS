"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import type { LeadRow, LeadStatusValue } from "@/services/leads-service";

const STATUS_TONE: Record<LeadStatusValue, StatusTone> = {
  NEW: "info",
  UNDER_FOLLOW_UP: "warning",
  PAID: "success",
  ARCHIVED: "neutral",
};

function LeadStatusCell({ status }: { status: LeadStatusValue }) {
  const { t } = useLocale();
  return (
    <StatusBadge tone={STATUS_TONE[status]} label={t(`crm.leads.status.${status}` as MessageKey)} />
  );
}

/** Every lead is linked to a Customer master record from creation (TASK-061) — this badge is the "clear existing customer indication" the UI must always show. */
function CustomerCell({ row }: { row: LeadRow }) {
  const { t } = useLocale();
  if (!row.customer) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
        {row.customer.customerNumber}
      </code>
      {row.possibleDuplicate && (
        <StatusBadge tone="warning" label={t("crm.leads.possibleDuplicate")} />
      )}
    </span>
  );
}

export const leadColumns: ColumnDef<LeadRow, unknown>[] = [
  {
    id: "leadNumber",
    meta: { titleKey: "crm.leads.fields.leadNumber" },
    accessorFn: (row) => row.leadNumber,
    cell: (info) => (
      <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
        {info.getValue() as string}
      </code>
    ),
  },
  {
    id: "customerName",
    meta: { titleKey: "crm.leads.fields.customerName" },
    accessorFn: (row) => row.customerName,
    cell: (info) => <span className="font-medium">{info.getValue() as string}</span>,
  },
  {
    id: "mobileNumber",
    meta: { titleKey: "crm.leads.fields.mobileNumber" },
    accessorFn: (row) => row.mobileNumber,
    cell: (info) => <span dir="ltr">{info.getValue() as string}</span>,
  },
  {
    id: "customer",
    meta: { titleKey: "crm.leads.fields.customer" },
    enableSorting: false,
    cell: ({ row }) => <CustomerCell row={row.original} />,
  },
  {
    id: "quantity",
    meta: { titleKey: "crm.leads.fields.quantity" },
    accessorFn: (row) => row.quantity,
  },
  {
    id: "status",
    meta: { titleKey: "common.status" },
    enableSorting: false,
    cell: ({ row }) => <LeadStatusCell status={row.original.status} />,
  },
  {
    id: "salesEmployee",
    meta: { titleKey: "crm.leads.fields.assignedTo" },
    enableSorting: false,
    accessorFn: (row) => row.salesEmployee?.fullName ?? "—",
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
  "createdAt",
];

export const leadRowLabel = (row: LeadRow) => `${row.leadNumber} — ${row.customerName}`;
