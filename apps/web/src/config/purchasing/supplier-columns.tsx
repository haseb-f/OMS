"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { statusColumn } from "@/config/master-data/shared-columns";
import { formatDate } from "@/lib/date";
import type { SupplierRow } from "@/services/suppliers-service";

/** Mirrors `config/sales/customer-columns.tsx` — no `balance`/`source` (Supplier has neither). */
export const supplierColumns: ColumnDef<SupplierRow, unknown>[] = [
  {
    id: "supplierNumber",
    meta: { titleKey: "purchasing.suppliers.fields.supplierNumber", type: "code" },
    accessorFn: (row) => row.supplierNumber,
    cell: ({ row }) => (
      <SemanticValue kind="id" className="text-body font-medium">
        {row.original.supplierNumber}
      </SemanticValue>
    ),
  },
  {
    id: "name",
    meta: { titleKey: "purchasing.suppliers.fields.name", stacked: true, type: "name" },
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
    meta: { titleKey: "purchasing.suppliers.fields.phone", defaultHidden: true },
    accessorFn: (row) => row.phone ?? "—",
    cell: (info) => <span dir="ltr">{info.getValue() as string}</span>,
  },
  {
    id: "email",
    meta: { titleKey: "purchasing.suppliers.fields.email" },
    accessorFn: (row) => row.email ?? "—",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.email ? <SemanticValue kind="email">{row.original.email}</SemanticValue> : "—",
  },
  {
    id: "city",
    meta: { titleKey: "purchasing.suppliers.fields.city" },
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
    meta: { titleKey: "purchasing.suppliers.fields.country", defaultHidden: true },
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
    cell: ({ row }) =>
      row.original.creditLimit == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <MoneyValue value={row.original.creditLimit} />
      ),
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
