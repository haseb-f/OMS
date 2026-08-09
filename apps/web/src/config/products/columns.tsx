"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge } from "@/components/business/status-badge";
import type { MessageKey } from "@/i18n/translate";
import { useLocale } from "@/providers/locale-provider";
import type { ProductRow } from "@/services/products-service";

const TYPE_TONE: Record<ProductRow["type"], "success" | "info" | "warning" | "neutral"> = {
  PURCHASE_ONLY: "warning",
  SALES_ONLY: "warning",
  PURCHASE_AND_SALE: "success",
  MANUFACTURED: "info",
  SERVICE: "info",
  EXPENSE_ITEM: "neutral",
};

function TypeCell({ type }: { type: ProductRow["type"] }) {
  const { t } = useLocale();
  return <StatusBadge tone={TYPE_TONE[type]} label={t(`products.type.${type}` as MessageKey)} />;
}

function ArchiveStatusCell({ deletedAt }: { deletedAt: string | null }) {
  const { t } = useLocale();
  return deletedAt ? (
    <StatusBadge label={t("common.archived")} tone="neutral" />
  ) : (
    <StatusBadge label={t("common.active")} tone="success" />
  );
}

export const productsColumns: ColumnDef<ProductRow, unknown>[] = [
  {
    id: "sku",
    meta: { titleKey: "products.table.sku" },
    accessorFn: (row) => row.sku,
    cell: (info) => (
      <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
        {info.getValue() as string}
      </code>
    ),
  },
  {
    id: "name",
    meta: { titleKey: "products.table.name" },
    accessorFn: (row) => row.displayName || row.name,
    cell: (info) => <span className="font-medium">{info.getValue() as string}</span>,
  },
  {
    id: "type",
    meta: { titleKey: "products.table.type" },
    accessorFn: (row) => row.type,
    cell: ({ row }) => <TypeCell type={row.original.type} />,
  },
  {
    id: "category",
    meta: { titleKey: "products.table.category" },
    accessorFn: (row) => row.category?.name ?? "—",
    enableSorting: false,
  },
  {
    id: "salesPrice",
    meta: { titleKey: "products.table.salesPrice" },
    accessorFn: (row) => row.salesPrice,
    cell: (info) => {
      const value = info.getValue() as string | null;
      return <span dir="ltr">{value ? Number(value).toLocaleString() : "—"}</span>;
    },
  },
  {
    id: "status",
    meta: { titleKey: "products.table.status" },
    enableSorting: false,
    cell: ({ row }) => <ArchiveStatusCell deletedAt={row.original.deletedAt} />,
  },
];

export const productsExportColumns = [
  "sku",
  "name",
  "internalName",
  "displayName",
  "type",
  "status",
  "salesPrice",
  "purchasePrice",
];
