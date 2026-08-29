"use client";

import {
  TableDetailField,
  TableDetailLineItems,
  TableDetailSection,
  TableDetailStack,
  formatPartyAddress,
  type TableDetailRegion,
} from "@/components/shared/data-table";
import { TruncateText } from "@/components/shared/truncate-text";
import { SemanticValue } from "@/components/shared/semantic-value";
import type { MessageKey } from "@/i18n/translate";
import type { StoreOrderRow } from "@/services/store-orders-service";
import { latestShipment } from "@/components/store-orders/store-order-row-cells";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Extra facts only — never repeats order number, customer name, payment, or shipping status. */
export function buildStoreOrderDetailRegions(
  order: StoreOrderRow,
  t: Translate,
  onShowMore?: () => void,
): TableDetailRegion[] {
  const shipment = latestShipment(order);
  const address = formatPartyAddress(order.partner);
  const email = order.partner?.email?.trim() || null;
  const notes = order.notes?.trim() || null;
  const regions: TableDetailRegion[] = [];

  if (order.items.length > 0) {
    regions.push({
      startColumnId: "internalOrderId",
      grow: "until-next-region",
      content: (
        <TableDetailSection title={t("storeOrders.createDialog.items.title")}>
          <TableDetailLineItems
            items={order.items.map((item) => ({
              id: item.id,
              name: item.product?.name ?? null,
              fallbackId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
            }))}
            currency={order.currency}
            emptyLabel={t("common.noDataAvailable")}
            moreLabel={(count) => t("table.showMore", { count })}
            onShowMore={onShowMore}
          />
        </TableDetailSection>
      ),
    });
  }

  if (address || email) {
    regions.push({
      startColumnId: "customer",
      grow: "until-next-region",
      content: (
        <TableDetailSection title={t("storeOrders.detail.sections.customer")}>
          <TableDetailField
            primary={
              address ? (
                <TruncateText className="font-medium">{address}</TruncateText>
              ) : email ? (
                <SemanticValue kind="email">{email}</SemanticValue>
              ) : undefined
            }
            secondary={
              address && email ? <SemanticValue kind="email">{email}</SemanticValue> : undefined
            }
          />
        </TableDetailSection>
      ),
    });
  }

  if (notes) {
    regions.push({
      startColumnId: "orderDate",
      grow: "until-next-region",
      content: (
        <TableDetailSection title={t("storeOrders.createDialog.sections.notes")}>
          <TableDetailField primary={<TruncateText>{notes}</TruncateText>} />
        </TableDetailSection>
      ),
    });
  }

  const payment = order.payments?.[0];
  const paymentMethod = payment?.paymentSource?.name?.trim() || null;
  const paymentReference =
    payment?.referenceNumber?.trim() || payment?.paymentNumber?.trim() || null;
  if (paymentMethod || paymentReference) {
    regions.push({
      startColumnId: "paymentStatus",
      grow: "until-next-region",
      content: (
        <TableDetailSection title={t("storeOrders.detail.sections.payments")}>
          <TableDetailField
            primary={paymentMethod ?? paymentReference}
            secondary={
              paymentMethod && paymentReference ? (
                <SemanticValue kind="id">{paymentReference}</SemanticValue>
              ) : undefined
            }
          />
        </TableDetailSection>
      ),
    });
  }

  const sourceLabel =
    order.source === "IMPORT" ? t("storeOrders.source.IMPORT") : t("storeOrders.source.MANUAL");
  const sourceText = order.sourceChannel ? `${sourceLabel} · ${order.sourceChannel}` : sourceLabel;
  const carrier = shipment?.shippingCompany?.name?.trim() || null;

  regions.push({
    startColumnId: "shippingStage",
    grow: "until-next-region",
    content: (
      <TableDetailSection title={t("storeOrders.fields.source")}>
        <TableDetailField
          primary={sourceText}
          secondary={carrier ? <TruncateText>{carrier}</TruncateText> : undefined}
        />
      </TableDetailSection>
    ),
  });

  return regions;
}

export function StoreOrderDetailStack({
  order,
  t,
  onShowMore,
}: {
  order: StoreOrderRow;
  t: Translate;
  onShowMore?: () => void;
}) {
  const regions = buildStoreOrderDetailRegions(order, t, onShowMore);
  return (
    <TableDetailStack>
      {regions.map((region) => (
        <div key={region.startColumnId}>{region.content}</div>
      ))}
    </TableDetailStack>
  );
}
