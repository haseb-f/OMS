"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import type { MessageKey } from "@/i18n/translate";
import { useLocale } from "@/providers/locale-provider";
import type { ProductRow, ProductStatus, ProductSupplyMethod } from "@/services/products-service";

export const STATUS_TONE: Record<ProductStatus, StatusTone> = {
  DRAFT: "warning",
  ACTIVE: "success",
  INACTIVE: "neutral",
};

/** Archived (soft-deleted) always wins the badge — otherwise shows the real DRAFT/ACTIVE/INACTIVE lifecycle state, not just a binary active/archived flag. */
export function ProductStatusCell({
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

export function ItemTypeLabel({ itemType }: { itemType: "PRODUCT" | "SERVICE" | null }) {
  const { t } = useLocale();
  return itemType ? (
    <span>{t(`products.attr.itemType.${itemType}`)}</span>
  ) : (
    <StatusBadge label={t("productCommission.itemType.UNSET")} tone="warning" />
  );
}

const SUPPLY_TONE: Record<ProductSupplyMethod, StatusTone> = {
  PURCHASED: "neutral",
  ASSEMBLED: "info",
  KIT: "info",
};

/** Purchased / Assembled / Kit — a service has no supply method. */
export function SupplyMethodCell({ row }: { row: Pick<ProductRow, "itemType" | "supplyMethod"> }) {
  const { t } = useLocale();
  if (row.itemType === "SERVICE") return <span className="text-muted-foreground">—</span>;
  return (
    <StatusBadge
      tone={SUPPLY_TONE[row.supplyMethod]}
      label={t(`products.attr.supplyMethod.${row.supplyMethod}`)}
    />
  );
}

/** "Sold · Purchased · Tracked" — the independent attributes, in words, never a combined type. */
export function ProductTraits({
  row,
}: {
  row: Pick<ProductRow, "isSellable" | "isPurchasable" | "isInventoryItem">;
}) {
  const { t } = useLocale();
  const traits = [
    row.isSellable ? t("products.traits.sold") : null,
    row.isPurchasable ? t("products.traits.purchased") : null,
    row.isInventoryItem ? t("products.traits.tracked") : null,
  ].filter(Boolean);
  return traits.length ? <span>{traits.join(" · ")}</span> : <span>—</span>;
}

export function ownershipLabel(
  row: Pick<ProductRow, "ownerAgentId" | "ownerAgent">,
  t: (key: MessageKey) => string,
): string {
  if (!row.ownerAgentId) return t("agentPricing.ownership.COMPANY");
  return row.ownerAgent?.name ?? t("agentPricing.ownership.AGENT");
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
    meta: { titleKey: "products.table.name", stacked: true, type: "name", identity: true },
    accessorFn: (row) => row.displayName || row.name,
    cell: ({ row }) => (
      <StackedCell
        primary={row.original.displayName || row.original.name}
        secondary={row.original.category?.name ?? undefined}
      />
    ),
  },
  {
    // commission-policy.md A2 — explicit PRODUCT / SERVICE; unclassified legacy items stand out for review.
    id: "itemType",
    meta: {
      titleKey: "products.facets.itemType",
      displayValue: (row, t) =>
        row.itemType
          ? t(`products.attr.itemType.${row.itemType}`)
          : t("productCommission.itemType.UNSET"),
    },
    accessorFn: (row) => row.itemType ?? "UNSET",
    cell: ({ row }) => <ItemTypeLabel itemType={row.original.itemType ?? null} />,
  },
  {
    id: "supplyMethod",
    meta: {
      titleKey: "products.attr.supplyMethod.label",
      displayValue: (row, t) =>
        row.itemType === "SERVICE" ? "—" : t(`products.attr.supplyMethod.${row.supplyMethod}`),
    },
    accessorFn: (row) => (row.itemType === "SERVICE" ? "" : row.supplyMethod),
    enableSorting: false,
    cell: ({ row }) => <SupplyMethodCell row={row.original} />,
  },
  {
    id: "traits",
    meta: {
      titleKey: "products.facets.traits",
      displayValue: (row, t) =>
        [
          row.isSellable ? t("products.traits.sold") : null,
          row.isPurchasable ? t("products.traits.purchased") : null,
          row.isInventoryItem ? t("products.traits.tracked") : null,
        ]
          .filter(Boolean)
          .join(" · ") || "—",
    },
    enableSorting: false,
    cell: ({ row }) => <ProductTraits row={row.original} />,
  },
  {
    id: "ownership",
    meta: {
      titleKey: "agentPricing.ownership.label",
      defaultHidden: true,
      displayValue: (row, t) => ownershipLabel(row, t),
    },
    enableSorting: false,
    accessorFn: (row) => row.ownerAgent?.name ?? "",
    cell: ({ row }) => <OwnershipCell row={row.original} />,
  },
  {
    id: "category",
    meta: { titleKey: "products.table.category", defaultHidden: true },
    accessorFn: (row) => row.category?.name ?? "—",
    enableSorting: false,
  },
  {
    id: "salesPrice",
    meta: { titleKey: "products.table.salesPrice", type: "money" },
    accessorFn: (row) => row.salesPrice,
    cell: ({ row }) =>
      row.original.salesPrice ? <MoneyValue value={row.original.salesPrice} /> : "—",
  },
  {
    id: "status",
    meta: { titleKey: "products.table.status", type: "status" },
    enableSorting: false,
    cell: ({ row }) => (
      <ProductStatusCell status={row.original.status} deletedAt={row.original.deletedAt} />
    ),
  },
];

function OwnershipCell({ row }: { row: ProductRow }) {
  const { t } = useLocale();
  return <span>{ownershipLabel(row, t)}</span>;
}

export const productsExportColumns = [
  "sku",
  "name",
  "internalName",
  "displayName",
  "itemType",
  "supplyMethod",
  "status",
  "salesPrice",
  "purchasePrice",
];
