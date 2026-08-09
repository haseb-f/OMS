"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
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

function MoneyCell({ value }: { value: string | number | null }) {
  if (value === null || value === undefined)
    return <span className="text-muted-foreground">—</span>;
  return (
    <span dir="ltr">
      {Number(value).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}
    </span>
  );
}

/** The 12 data columns the task specifies — MasterDataPage appends the 13th ("Actions") automatically. */
export const customerColumns: ColumnDef<CustomerRow, unknown>[] = [
  {
    id: "customerNumber",
    meta: { titleKey: "sales.customers.fields.customerNumber" },
    accessorFn: (row) => row.customerNumber,
    cell: (info) => (
      <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
        {info.getValue() as string}
      </code>
    ),
  },
  {
    id: "name",
    meta: { titleKey: "sales.customers.fields.name" },
    accessorFn: (row) => row.name,
    cell: (info) => <span className="font-medium">{info.getValue() as string}</span>,
  },
  {
    id: "phone",
    meta: { titleKey: "sales.customers.fields.phone" },
    accessorFn: (row) => row.phone ?? "—",
    cell: (info) => <span dir="ltr">{info.getValue() as string}</span>,
  },
  {
    id: "email",
    meta: { titleKey: "sales.customers.fields.email" },
    accessorFn: (row) => row.email ?? "—",
    enableSorting: false,
  },
  {
    id: "city",
    meta: { titleKey: "sales.customers.fields.city" },
    accessorFn: (row) => row.city ?? "—",
    enableSorting: false,
  },
  {
    id: "country",
    meta: { titleKey: "sales.customers.fields.country" },
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
    cell: (info) => <MoneyCell value={info.getValue() as string | null} />,
  },
  {
    id: "balance",
    meta: { titleKey: "sales.customers.fields.balance" },
    accessorFn: (row) => row.balance,
    cell: (info) => <MoneyCell value={info.getValue() as number} />,
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
