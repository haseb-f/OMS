"use client";

import type { ReactNode } from "react";
import { RecordGridCard } from "@/components/shared/data-table";
import type { RecordGridCardField } from "@/components/shared/data-table/record-grid-card";
import { LocaleText } from "@/components/shared/locale-text";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { useLocale } from "@/providers/locale-provider";
import type { ProductRow } from "@/services/products-service";
import { ItemTypeLabel, ProductStatusCell, STATUS_TONE, TypeCell } from "./columns";

/**
 * Grid-view template of the Products list (round 9). Shows exactly what the
 * table shows: name, SKU, category, sales price, status, type, unit and the
 * commission item type. Purchase price and any cost/margin are on the row type
 * but NOT in the table, so they are never drawn here either.
 */
export function ProductGridCard({
  row,
  selected,
  onToggleSelected,
  href,
  actionsNode,
}: {
  row: ProductRow;
  selected: boolean;
  onToggleSelected: () => void;
  href: string;
  /** The page's own row-actions menu (same permissions as the table). */
  actionsNode: ReactNode;
}) {
  const { t } = useLocale();
  const name = row.displayName || row.name;
  const archived = Boolean(row.deletedAt);

  const fields: RecordGridCardField[] = [
    { key: "unit", label: t("products.fields.unit"), value: row.unit?.name ?? "—" },
    {
      key: "itemType",
      label: t("productCommission.itemType.label"),
      value: <ItemTypeLabel itemType={row.itemType ?? null} />,
    },
  ];

  return (
    <RecordGridCard
      tone={archived ? "neutral" : STATUS_TONE[row.status]}
      selected={selected}
      onToggleSelected={onToggleSelected}
      selectLabel={t("tableViews.card.selectRow", { name })}
      title={<LocaleText>{name}</LocaleText>}
      subtitle={row.category?.name ?? undefined}
      href={href}
      reference={
        <SemanticValue kind="id" className="font-medium">
          {row.sku}
        </SemanticValue>
      }
      meta={
        row.salesPrice ? <MoneyValue value={row.salesPrice} className="text-foreground" /> : null
      }
      fields={fields}
      badges={
        <>
          <ProductStatusCell status={row.status} deletedAt={row.deletedAt} />
          <TypeCell type={row.type} />
        </>
      }
      actionsNode={actionsNode}
      actionsLabel={t("tableViews.card.actions")}
    />
  );
}
