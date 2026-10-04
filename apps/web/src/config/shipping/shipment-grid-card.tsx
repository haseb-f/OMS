"use client";

import { EnterpriseBadge } from "@/components/ui/badge";
import { RecordGridCard } from "@/components/shared/data-table";
import type { RecordGridCardField } from "@/components/shared/data-table/record-grid-card";
import { LocaleText } from "@/components/shared/locale-text";
import { SemanticValue } from "@/components/shared/semantic-value";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { ShipmentListRow } from "@/services/shipping-service";
import { ShipmentActionsCell, type ShipmentRowHandlers } from "./shipment-columns";
import { ShipmentStatusBadge, shipmentRowTone } from "./shipment-quick-edit-cells";

/**
 * The shipment record card of the Grid view (Round 9). Read-only by design: the
 * table's inline editors (status, company, tracking) are not drawn here - the
 * card shows the same values as text and badges, and the row's own actions menu
 * (View / Manage) is the one way to change a shipment. The card links to the
 * order exactly like the table's identity link.
 */
export function ShipmentGridCard({
  row,
  handlers,
  selected,
  onToggleSelected,
  href,
}: {
  row: ShipmentListRow;
  handlers: ShipmentRowHandlers;
  selected: boolean;
  onToggleSelected: () => void;
  href: string;
}) {
  const { t } = useLocale();
  const customer = row.storeOrder.partner;
  const title = customer?.name ?? row.storeOrder.internalOrderId;
  const fields: RecordGridCardField[] = [
    {
      key: "shippingCompany",
      label: t("shipping.fields.shippingCompany"),
      value: row.shippingCompany?.name ? <LocaleText>{row.shippingCompany.name}</LocaleText> : "—",
    },
    {
      key: "trackingNumber",
      label: t("shipping.fields.trackingNumber"),
      value: row.trackingNumber ? (
        <SemanticValue kind="id">{row.trackingNumber}</SemanticValue>
      ) : (
        <span className="text-muted-foreground">{t("shipping.quickEdit.trackingEmpty")}</span>
      ),
    },
  ];
  if (customer?.country?.name) {
    fields.push({
      key: "destination",
      label: t("shipping.filters.country"),
      value: <LocaleText>{customer.country.name}</LocaleText>,
    });
  }
  if (row.shippedAt) {
    fields.push({
      key: "shippedAt",
      label: t("shipping.fields.shippedAt"),
      value: <SemanticValue kind="date">{formatDate(row.shippedAt)}</SemanticValue>,
    });
  }
  return (
    <RecordGridCard
      tone={shipmentRowTone(row)}
      selected={selected}
      onToggleSelected={onToggleSelected}
      selectLabel={t("tableViews.card.selectRow", { name: title })}
      title={<LocaleText>{title}</LocaleText>}
      subtitle={
        customer?.phone ? <SemanticValue kind="phone">{customer.phone}</SemanticValue> : null
      }
      href={href}
      reference={
        <SemanticValue kind="id" className="font-medium">
          {row.storeOrder.internalOrderId}
        </SemanticValue>
      }
      meta={
        row.storeOrder.externalOrderId ? (
          <SemanticValue kind="id">{row.storeOrder.externalOrderId}</SemanticValue>
        ) : null
      }
      fields={fields}
      badges={
        <>
          <ShipmentStatusBadge row={row} />
          {row.attemptNumber > 1 ? (
            <EnterpriseBadge variant="outline" className="text-xs">
              #{row.attemptNumber}
            </EnterpriseBadge>
          ) : null}
        </>
      }
      actionsNode={<ShipmentActionsCell row={row} handlers={handlers} />}
      actionsLabel={t("tableViews.card.actions")}
    />
  );
}
