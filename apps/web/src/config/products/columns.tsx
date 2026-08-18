"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import type { MessageKey } from "@/i18n/translate";
import { useLocale } from "@/providers/locale-provider";
import type { ProductRow, ProductStatus } from "@/services/products-service";

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

const STATUS_TONE: Record<ProductStatus, StatusTone> = {
  DRAFT: "warning",
  ACTIVE: "success",
  INACTIVE: "neutral",
};

/** Archived (soft-deleted) always wins the badge — otherwise shows the real DRAFT/ACTIVE/INACTIVE lifecycle state, not just a binary active/archived flag. */
function ProductStatusCell({
  status,
  deletedAt,
}: {
  status: ProductStatus;
  deletedAt: string | null;
}) {
  const { t } = useLocale();
  return deletedAt ? (
    <StatusBadge label={t("common.archived")} tone="neutral" />
  ) : (
    <StatusBadge label={t(`products.status.${status}`)} tone={STATUS_TONE[status]} />
  );
}

export const productsColumns: ColumnDef<ProductRow, unknown>[] = [
  {
    id: "sku",
    meta: { titleKey: "products.table.sku", type: "code" },
    accessorFn: (row) => row.sku,
    cell: ({ row }) => (
      <SemanticValue kind="id" className="text-body font-medium">
        {row.original.sku}
      </SemanticValue>
    ),
  },
  {
    id: "name",
    meta: { titleKey: "products.table.name", stacked: true, type: "name" },
    accessorFn: (row) => row.displayName || row.name,
    cell: ({ row }) => (
      <StackedCell
        primary={row.original.displayName || row.original.name}
        secondary={row.original.category?.name ?? undefined}
      />
    ),
  },
  {
    id: "type",
    meta: { titleKey: "products.table.type" },
    accessorFn: (row) => row.type,
    cell: ({ row }) => <TypeCell type={row.original.type} />,
  },
  {
    id: "category",
    meta: { titleKey: "products.table.category", defaultHidden: true },
    accessorFn: (row) => row.category?.name ?? "—",
    enableSorting: false,
  },
  {
    id: "salesPrice",
    meta: { titleKey: "products.table.salesPrice" },
    accessorFn: (row) => row.salesPrice,
    cell: ({ row }) =>
      row.original.salesPrice ? <MoneyValue value={row.original.salesPrice} /> : "—",
  },
  {
    id: "status",
    meta: { titleKey: "products.table.status" },
    enableSorting: false,
    cell: ({ row }) => (
      <ProductStatusCell status={row.original.status} deletedAt={row.original.deletedAt} />
    ),
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
