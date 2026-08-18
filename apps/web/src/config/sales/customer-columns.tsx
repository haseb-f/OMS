"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { statusColumn } from "@/config/master-data/shared-columns";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import type { CustomerRow, CustomerSourceValue } from "@/services/customers-service";

const SOURCE_TONE: Record<CustomerSourceValue, StatusTone> = {
  MANUAL: "neutral",
  WEBSITE: "info",
  SALLA: "info",
  API: "info",
  IMPORT: "warning",
  GOOGLE_SHEETS: "warning",
  LEAD_CONVERSION: "success",
  OTHER: "neutral",
};

function SourceCell({ source }: { source: CustomerSourceValue }) {
  const { t } = useLocale();
  return (
    <StatusBadge
      tone={SOURCE_TONE[source]}
      label={t(`sales.customers.source.${source}` as MessageKey)}
    />
  );
}

/** The 12 data columns the task specifies — MasterDataPage appends the 13th ("Actions") automatically. */
export const customerColumns: ColumnDef<CustomerRow, unknown>[] = [
  {
    id: "customerNumber",
    meta: { titleKey: "sales.customers.fields.customerNumber", type: "code" },
    accessorFn: (row) => row.customerNumber,
    cell: ({ row }) => (
      <SemanticValue kind="id" className="text-body font-medium">
        {row.original.customerNumber}
      </SemanticValue>
    ),
  },
  {
    id: "name",
    meta: { titleKey: "sales.customers.fields.name", stacked: true, type: "name" },
    accessorFn: (row) => row.name,
    cell: ({ row }) => (
      <StackedCell
        primary={row.original.name}
        secondary={
          row.original.phone ? (
            <SemanticValue kind="phone">{row.original.phone}</SemanticValue>
          ) : undefined
        }
      />
    ),
  },
  {
    id: "phone",
    meta: { titleKey: "sales.customers.fields.phone", defaultHidden: true },
    accessorFn: (row) => row.phone ?? "—",
    cell: (info) => <span dir="ltr">{info.getValue() as string}</span>,
  },
  {
    id: "email",
    meta: { titleKey: "sales.customers.fields.email" },
    accessorFn: (row) => row.email ?? "—",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.email ? <SemanticValue kind="email">{row.original.email}</SemanticValue> : "—",
  },
  {
    id: "city",
    meta: { titleKey: "sales.customers.fields.city" },
    accessorFn: (row) => row.city ?? "—",
    enableSorting: false,
    cell: ({ row }) => (
      <StackedCell
        primary={row.original.city ?? "—"}
        secondary={row.original.country?.name ?? undefined}
      />
    ),
  },
  {
    id: "country",
    meta: { titleKey: "sales.customers.fields.country", defaultHidden: true },
    accessorFn: (row) => row.country?.name ?? "—",
    enableSorting: false,
  },
  {
    id: "paymentTerm",
    meta: { titleKey: "sales.customers.fields.paymentTerm" },
    accessorFn: (row) => row.paymentTerm?.name ?? "—",
    enableSorting: false,
  },
  {
    id: "creditLimit",
    meta: { titleKey: "sales.customers.fields.creditLimit" },
    accessorFn: (row) => row.creditLimit,
    cell: ({ row }) =>
      row.original.creditLimit == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <MoneyValue value={row.original.creditLimit} />
      ),
  },
  {
    id: "balance",
    meta: { titleKey: "sales.customers.fields.balance" },
    accessorFn: (row) => row.balance,
    cell: ({ row }) => <MoneyValue value={row.original.balance} />,
  },
  statusColumn<CustomerRow>(),
  {
    id: "createdAt",
    meta: { titleKey: "sales.customers.fields.createdAt" },
    accessorFn: (row) => formatDate(row.createdAt),
  },
  {
    id: "source",
    meta: { titleKey: "sales.customers.fields.source" },
    enableSorting: false,
    cell: ({ row }) => <SourceCell source={row.original.source} />,
  },
];

export const customerExportColumns = [
  "customerNumber",
  "name",
  "phone",
  "email",
  "city",
  "country",
  "creditLimit",
  "balance",
  "status",
  "source",
];

export const customerRowLabel = (row: CustomerRow) => `${row.customerNumber} — ${row.name}`;
