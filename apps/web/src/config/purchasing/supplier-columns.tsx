"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { statusColumn } from "@/config/master-data/shared-columns";
import { formatDate } from "@/lib/date";
import type { SupplierRow } from "@/services/suppliers-service";

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

/** Mirrors `config/sales/customer-columns.tsx` — no `balance`/`source` (Supplier has neither). */
export const supplierColumns: ColumnDef<SupplierRow, unknown>[] = [
  {
    id: "supplierNumber",
    meta: { titleKey: "purchasing.suppliers.fields.supplierNumber" },
    accessorFn: (row) => row.supplierNumber,
    cell: (info) => (
      <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
        {info.getValue() as string}
      </code>
    ),
  },
  {
    id: "name",
    meta: { titleKey: "purchasing.suppliers.fields.name" },
    accessorFn: (row) => row.name,
    cell: (info) => <span className="font-medium">{info.getValue() as string}</span>,
  },
  {
    id: "phone",
    meta: { titleKey: "purchasing.suppliers.fields.phone" },
    accessorFn: (row) => row.phone ?? "—",
    cell: (info) => <span dir="ltr">{info.getValue() as string}</span>,
  },
  {
    id: "email",
    meta: { titleKey: "purchasing.suppliers.fields.email" },
    accessorFn: (row) => row.email ?? "—",
    enableSorting: false,
  },
  {
    id: "city",
    meta: { titleKey: "purchasing.suppliers.fields.city" },
    accessorFn: (row) => row.city ?? "—",
    enableSorting: false,
  },
  {
    id: "country",
    meta: { titleKey: "purchasing.suppliers.fields.country" },
    accessorFn: (row) => row.country?.name ?? "—",
    enableSorting: false,
  },
  {
    id: "paymentTerm",
    meta: { titleKey: "purchasing.suppliers.fields.paymentTerm" },
    accessorFn: (row) => row.paymentTerm ?? "—",
    enableSorting: false,
  },
  {
    id: "creditLimit",
    meta: { titleKey: "purchasing.suppliers.fields.creditLimit" },
    accessorFn: (row) => row.creditLimit,
    cell: (info) => <MoneyCell value={info.getValue() as string | null} />,
  },
  statusColumn<SupplierRow>(),
  {
    id: "createdAt",
    meta: { titleKey: "purchasing.suppliers.fields.createdAt" },
    accessorFn: (row) => formatDate(row.createdAt),
  },
];

export const supplierExportColumns = [
  "supplierNumber",
  "name",
  "phone",
  "email",
  "city",
  "country",
  "creditLimit",
  "status",
];

export const supplierRowLabel = (row: SupplierRow) => `${row.supplierNumber} — ${row.name}`;
