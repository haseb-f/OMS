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
import type { PartnerRow, PartnerRoleValue, PartnerSourceValue } from "@/services/partners-service";

const SOURCE_TONE: Record<PartnerSourceValue, StatusTone> = {
  MANUAL: "neutral",
  WEBSITE: "info",
  SALLA: "info",
  API: "info",
  IMPORT: "warning",
  GOOGLE_SHEETS: "warning",
  LEAD_CONVERSION: "success",
  OTHER: "neutral",
};

const ROLE_TONE: Record<PartnerRoleValue, StatusTone> = {
  CUSTOMER: "info",
  SUPPLIER: "warning",
  EMPLOYEE: "success",
  OWNER: "neutral",
  OTHER: "neutral",
};

function SourceCell({ source }: { source: PartnerSourceValue }) {
  const { t } = useLocale();
  return (
    <StatusBadge tone={SOURCE_TONE[source]} label={t(`partners.source.${source}` as MessageKey)} />
  );
}

function RolesCell({ roles }: { roles: PartnerRow["roles"] }) {
  const { t } = useLocale();
  if (roles.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {roles.map((r) => (
        <StatusBadge
          key={r.id}
          tone={ROLE_TONE[r.role]}
          label={t(`partners.roles.${r.role}` as MessageKey)}
        />
      ))}
    </div>
  );
}

/** Base identity columns every Partner view (master list, Customers, Suppliers) shares. Role-scoped pages append their own extra columns (credit limit, balance) after these. */
export const partnerBaseColumns: ColumnDef<PartnerRow, unknown>[] = [
  {
    id: "partnerNumber",
    meta: { titleKey: "partners.fields.partnerNumber", type: "code", identity: true },
    accessorFn: (row) => row.partnerNumber,
    cell: ({ row }) => (
      <SemanticValue kind="id" className="text-body font-medium">
        {row.original.partnerNumber}
      </SemanticValue>
    ),
  },
  {
    id: "name",
    meta: { titleKey: "partners.fields.name", stacked: true, type: "name" },
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
    id: "roles",
    meta: { titleKey: "partners.fields.roles" },
    enableSorting: false,
    cell: ({ row }) => <RolesCell roles={row.original.roles} />,
  },
  {
    id: "phone",
    meta: { titleKey: "partners.fields.phone", defaultHidden: true },
    accessorFn: (row) => row.phone ?? "—",
    cell: (info) => <span dir="ltr">{info.getValue() as string}</span>,
  },
  {
    id: "email",
    meta: { titleKey: "partners.fields.email" },
    accessorFn: (row) => row.email ?? "—",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.email ? <SemanticValue kind="email">{row.original.email}</SemanticValue> : "—",
  },
  {
    id: "city",
    meta: { titleKey: "partners.fields.city" },
    accessorFn: (row) => row.city ?? "—",
    enableSorting: false,
    cell: ({ row }) => (
      <StackedCell
        primary={row.original.city ?? "—"}
        secondary={row.original.country?.name ?? undefined}
      />
    ),
  },
  statusColumn<PartnerRow>(),
  {
    id: "createdAt",
    meta: { titleKey: "partners.fields.createdAt", defaultHidden: true },
    accessorFn: (row) => formatDate(row.createdAt),
  },
  {
    id: "source",
    meta: { titleKey: "partners.fields.source", defaultHidden: true },
    enableSorting: false,
    cell: ({ row }) => <SourceCell source={row.original.source} />,
  },
];

/** The full Partners master page — identity + both balances (spec section 12). */
export const partnerColumns: ColumnDef<PartnerRow, unknown>[] = [
  ...partnerBaseColumns,
  {
    id: "receivableBalance",
    meta: { titleKey: "partners.fields.receivableBalance" },
    accessorFn: (row) => row.receivableBalance,
    cell: ({ row }) => <MoneyValue value={row.original.receivableBalance} />,
  },
  {
    id: "payableBalance",
    meta: { titleKey: "partners.fields.payableBalance" },
    accessorFn: (row) => row.payableBalance,
    cell: ({ row }) => <MoneyValue value={row.original.payableBalance} />,
  },
];

/** Customers page — same identity columns, plus Customer-role fields, matching the pre-Partner Customer list's own column set. */
export const customerPartnerColumns: ColumnDef<PartnerRow, unknown>[] = [
  ...partnerBaseColumns,
  {
    id: "customerGroup",
    meta: { titleKey: "sales.customers.fields.customerGroup" },
    accessorFn: (row) => row.customerProfile?.customerGroup?.name ?? "—",
    enableSorting: false,
  },
  {
    id: "creditLimit",
    meta: { titleKey: "sales.customers.fields.creditLimit" },
    accessorFn: (row) => row.customerProfile?.creditLimit,
    cell: ({ row }) =>
      row.original.customerProfile?.creditLimit == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <MoneyValue value={row.original.customerProfile.creditLimit} />
      ),
  },
  {
    id: "receivableBalance",
    meta: { titleKey: "sales.customers.fields.balance" },
    accessorFn: (row) => row.receivableBalance,
    cell: ({ row }) => <MoneyValue value={row.original.receivableBalance} />,
  },
];

/** Suppliers page — same identity columns, plus Supplier-role fields, matching the pre-Partner Supplier list's own column set. */
export const supplierPartnerColumns: ColumnDef<PartnerRow, unknown>[] = [
  ...partnerBaseColumns,
  {
    id: "supplierGroup",
    meta: { titleKey: "purchasing.suppliers.fields.supplierGroup" },
    accessorFn: (row) => row.supplierProfile?.supplierGroup?.name ?? "—",
    enableSorting: false,
  },
  {
    id: "creditLimit",
    meta: { titleKey: "purchasing.suppliers.fields.creditLimit" },
    accessorFn: (row) => row.supplierProfile?.creditLimit,
    cell: ({ row }) =>
      row.original.supplierProfile?.creditLimit == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <MoneyValue value={row.original.supplierProfile.creditLimit} />
      ),
  },
  {
    id: "payableBalance",
    meta: { titleKey: "partners.fields.payableBalance" },
    accessorFn: (row) => row.payableBalance,
    cell: ({ row }) => <MoneyValue value={row.original.payableBalance} />,
  },
];

export const partnerExportColumns = ["partnerNumber", "name", "phone", "email", "city", "status"];
export const customerExportColumns = [
  "partnerNumber",
  "name",
  "phone",
  "email",
  "city",
  "creditLimit",
  "receivableBalance",
  "status",
  "source",
];
export const supplierExportColumns = [
  "partnerNumber",
  "name",
  "phone",
  "email",
  "city",
  "creditLimit",
  "payableBalance",
  "status",
  "source",
];

export const partnerRowLabel = (row: PartnerRow) => `${row.partnerNumber} — ${row.name}`;
