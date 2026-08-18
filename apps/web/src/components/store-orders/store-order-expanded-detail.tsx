"use client";

import {
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
  const address = formatPartyAddress(order.customer);
  const regions: TableDetailRegion[] = [];

  if (order.items.length > 0) {
    regions.push({
      startColumnId: "internalOrderId",
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

  if (address || order.customer?.email) {
    regions.push({
      startColumnId: "customer",
      content: (
        <TableDetailSection title={t("storeOrders.detail.sections.customer")}>
          {address ? (
            <TruncateText lines={2} className="text-muted-foreground">
              {address}
            </TruncateText>
          ) : null}
          {order.customer?.email ? (
            <p className={address ? "mt-1" : undefined}>
              <SemanticValue kind="email">{order.customer.email}</SemanticValue>
            </p>
          ) : null}
        </TableDetailSection>
      ),
    });
  }

  if (order.notes) {
    regions.push({
      startColumnId: "paymentStatus",
      content: (
        <TableDetailSection title={t("storeOrders.createDialog.sections.notes")}>
          <TruncateText lines={2} className="text-muted-foreground">
            {order.notes}
          </TruncateText>
        </TableDetailSection>
      ),
    });
  }

  const sourceLabel =
    order.source === "IMPORT" ? t("storeOrders.source.IMPORT") : t("storeOrders.source.MANUAL");
  const sourceText = order.sourceChannel ? `${sourceLabel} · ${order.sourceChannel}` : sourceLabel;
  const carrier = shipment?.shippingCompany?.name;

  regions.push({
    startColumnId: "shippingStage",
    content: (
      <TableDetailSection title={t("storeOrders.fields.source")}>
        <p className="text-muted-foreground">{sourceText}</p>
        {carrier ? (
          <TruncateText className="mt-1 text-muted-foreground">{carrier}</TruncateText>
        ) : null}
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
