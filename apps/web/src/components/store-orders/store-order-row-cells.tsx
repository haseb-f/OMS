"use client";

import { StatusBadge } from "@/components/business/status-badge";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { TruncateText } from "@/components/shared/truncate-text";
import { formatDate, formatTime, hasClockTime } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { StoreOrderRow } from "@/services/store-orders-service";
import {
  PAYMENT_STATUS_LABEL_KEY,
  PAYMENT_STATUS_TONE,
  SHIPPING_STAGE_LABEL_KEY,
  SHIPPING_STAGE_TONE,
} from "@/config/store-orders/status";

export function customerPhone(row: StoreOrderRow): string | null {
  return row.customer?.phone || row.customer?.mobile || null;
}

export function latestShipment(row: StoreOrderRow) {
  return row.shipments?.[0] ?? null;
}

export function StoreOrderIdentityCell({ order }: { order: StoreOrderRow }) {
  return (
    <StackedCell
      primary={
        <SemanticValue kind="id" className="text-body font-medium">
          {order.internalOrderId}
        </SemanticValue>
      }
      secondary={
        order.externalOrderId ? (
          <SemanticValue kind="id" className="font-sans">
            {order.externalOrderId}
          </SemanticValue>
        ) : undefined
      }
    />
  );
}

export function StoreOrderCustomerCell({ order }: { order: StoreOrderRow }) {
  const phone = customerPhone(order);
  return (
    <StackedCell
      primary={<TruncateText>{order.customer?.name ?? "—"}</TruncateText>}
      secondary={phone ? <SemanticValue kind="phone">{phone}</SemanticValue> : undefined}
    />
  );
}

export function StoreOrderDateCell({ order }: { order: StoreOrderRow }) {
  const dateLabel = formatDate(order.orderDate) || "—";
  const timeLabel = hasClockTime(order.orderDate) ? formatTime(order.orderDate) : undefined;
  return (
    <StackedCell
      primary={
        <span dir="ltr" className="tabular-nums">
          {dateLabel}
        </span>
      }
      secondary={
        timeLabel ? (
          <span dir="ltr" className="tabular-nums">
            {timeLabel}
          </span>
        ) : undefined
      }
    />
  );
}

export function StoreOrderPaymentCell({ order }: { order: StoreOrderRow }) {
  const { t } = useLocale();
  return (
    <StackedCell
      primary={
        <StatusBadge
          label={t(PAYMENT_STATUS_LABEL_KEY[order.paymentStatus])}
          tone={PAYMENT_STATUS_TONE[order.paymentStatus]}
        />
      }
      secondary={
        <MoneyValue value={order.total ?? "0"} currency={order.currency} className="font-normal" />
      }
    />
  );
}

export function StoreOrderShippingCell({ order }: { order: StoreOrderRow }) {
  const { t } = useLocale();
  const tracking = latestShipment(order)?.trackingNumber;
  return (
    <StackedCell
      primary={
        <StatusBadge
          label={t(SHIPPING_STAGE_LABEL_KEY[order.shippingStage])}
          tone={SHIPPING_STAGE_TONE[order.shippingStage]}
        />
      }
      secondary={
        tracking ? (
          <SemanticValue kind="id" className="font-sans">
            {tracking}
          </SemanticValue>
        ) : undefined
      }
    />
  );
}
