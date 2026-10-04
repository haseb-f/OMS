"use client";

import { Eye } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { RecordGridCard, type RowAction } from "@/components/shared/data-table";
import type { RecordGridCardField } from "@/components/shared/data-table/record-grid-card";
import { LocaleText } from "@/components/shared/locale-text";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { MOVEMENT_REFERENCE_KIND, RECORD_ROUTES } from "@/config/traceability/record-routes";
import { formatDate, formatDateTime } from "@/lib/date";
import { formatAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import type { InventoryMovementRow, StockCard } from "@/services/inventory-service";
import type { PhysicalCountListRow } from "@/services/physical-count-service";
import { movementTypeTone, PHYSICAL_COUNT_STATUS_TONE } from "./movement-type";

/**
 * Round 9 record-card templates of the Inventory lists. Quantities and amounts
 * are the tables' own figures (tabular, logical end); nothing is added that the
 * table does not show, and none of the three lists has a detail route, so no
 * card carries a link.
 */

interface SelectableChrome {
  selected: boolean;
  onToggleSelected: () => void;
}

/** Signed movement quantity: gains green, losses red - always with the +/- sign too. */
function SignedQuantity({ value }: { value: number }) {
  return (
    <span
      dir="ltr"
      className={cn("num font-medium", value < 0 ? "text-destructive" : "text-success")}
    >
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

export function InventoryMovementGridCard({
  row,
  selected,
  onToggleSelected,
}: SelectableChrome & { row: InventoryMovementRow }) {
  const { t } = useLocale();
  const productName = row.product?.displayName || row.product?.name || row.productId;
  const warehouse = row.warehouse ? `${row.warehouse.code} — ${row.warehouse.name}` : null;
  const referenceKind = row.referenceType ? MOVEMENT_REFERENCE_KIND[row.referenceType] : undefined;
  const fields: RecordGridCardField[] = [
    {
      key: "date",
      label: t("inventory.fields.date"),
      value: <SemanticValue kind="date">{formatDateTime(row.createdAt)}</SemanticValue>,
    },
    {
      key: "balanceAfter",
      label: t("inventory.fields.balanceAfter"),
      value: <span className="num">{row.quantityAfter}</span>,
      numeric: true,
    },
    {
      key: "unitCost",
      label: t("products.stockMovements.cost"),
      value: row.unitCost != null ? <span className="num">{formatAmount(row.unitCost)}</span> : "—",
      numeric: true,
    },
  ];
  if (row.referenceType) {
    fields.push({
      key: "reference",
      label: t("inventory.fields.reference"),
      value: referenceKind ? t(RECORD_ROUTES[referenceKind].labelKey) : row.referenceType,
    });
  }
  return (
    <RecordGridCard
      tone="neutral"
      selected={selected}
      onToggleSelected={onToggleSelected}
      selectLabel={t("tableViews.card.selectRow", { name: productName })}
      title={<LocaleText>{productName}</LocaleText>}
      subtitle={warehouse ? <LocaleText>{warehouse}</LocaleText> : null}
      reference={
        <SemanticValue kind="id" className="font-medium">
          {row.movementNumber}
        </SemanticValue>
      }
      meta={<SignedQuantity value={row.quantity} />}
      fields={fields}
      badges={
        <StatusBadge
          tone={movementTypeTone(row.type)}
          label={t(`inventory.movementType.${row.type}` as MessageKey)}
        />
      }
    />
  );
}

/** Stock list: no selection, no actions, no detail route - a read-only figure card. */
export function InventoryStockGridCard({ row }: { row: StockCard }) {
  const { t } = useLocale();
  return (
    <RecordGridCard
      tone="neutral"
      selected={false}
      title={<LocaleText>{row.productName}</LocaleText>}
      reference={
        row.sku ? (
          <SemanticValue kind="id" className="font-medium">
            {row.sku}
          </SemanticValue>
        ) : (
          "—"
        )
      }
      meta={
        <span className="inline-flex items-baseline gap-1.5">
          <span>{t("inventory.fields.available")}</span>
          <span dir="ltr" className="num font-semibold text-foreground">
            {row.available}
          </span>
        </span>
      }
      fields={[
        {
          key: "onHand",
          label: t("inventory.fields.onHand"),
          value: <span className="num">{row.onHand}</span>,
          numeric: true,
        },
        {
          key: "reserved",
          label: t("inventory.fields.reserved"),
          value: <span className="num">{row.reserved}</span>,
          numeric: true,
        },
        {
          key: "stockValue",
          label: t("inventory.fields.stockValue"),
          value: row.stockValue === null ? "—" : <MoneyValue value={row.stockValue} />,
          numeric: true,
        },
      ]}
    />
  );
}

/** The physical-count row actions - one builder for the table's actions column and the Grid card. */
export function physicalCountRowActions(
  row: PhysicalCountListRow,
  t: (key: MessageKey) => string,
  onOpen: (row: PhysicalCountListRow) => void,
): RowAction[] {
  return [
    {
      key: "view",
      label: t("common.view"),
      icon: Eye,
      onSelect: () => onOpen(row),
    },
  ];
}

export function PhysicalCountGridCard({
  row,
  actions,
  selected,
  onToggleSelected,
}: SelectableChrome & { row: PhysicalCountListRow; actions: RowAction[] }) {
  const { t } = useLocale();
  const warehouse = `${row.warehouse.code} — ${row.warehouse.name}`;
  const tone = PHYSICAL_COUNT_STATUS_TONE[row.status] ?? "neutral";
  return (
    <RecordGridCard
      tone={tone}
      selected={selected}
      onToggleSelected={onToggleSelected}
      selectLabel={t("tableViews.card.selectRow", { name: warehouse })}
      title={<LocaleText>{warehouse}</LocaleText>}
      reference={
        <SemanticValue kind="id" className="font-medium">
          {row.countNumber}
        </SemanticValue>
      }
      meta={<SemanticValue kind="date">{formatDate(row.createdAt)}</SemanticValue>}
      fields={[
        {
          key: "lines",
          label: t("inventory.physicalCount.lines"),
          value: <span className="num">{row._count.lines}</span>,
          numeric: true,
        },
      ]}
      badges={
        <StatusBadge
          tone={tone}
          label={t(`inventory.physicalCount.status.${row.status}` as MessageKey)}
        />
      }
      actions={actions}
      actionsLabel={t("tableViews.card.actions")}
    />
  );
}
