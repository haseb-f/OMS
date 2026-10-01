"use client";

import { StatusBadge } from "@/components/business/status-badge";
import { LocaleText } from "@/components/shared/locale-text";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { formatDate, formatTime, hasClockTime } from "@/lib/date";
import { declaredShortLabelKey } from "@/components/payments/declaration/declaration-status";
import { currencyCodeOf, formatMoney } from "@/lib/money";
import type { MessageKey } from "@/i18n/translate";
import { useLocale } from "@/providers/locale-provider";
import type { StoreOrderRow } from "@/services/store-orders-service";
import {
  PAYMENT_STATUS_TONE,
  SHIPPING_STAGE_LABEL_KEY,
  SHIPPING_STAGE_TONE,
  financialStatusLabelKey,
} from "@/config/store-orders/status";
import { catalogStatusTone, shippingStatusName } from "@/config/shipping/shipment-status";

export function customerPhone(row: StoreOrderRow): string | null {
  return row.partner?.phone || row.partner?.mobile || null;
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
      primary={order.partner?.name ? <LocaleText>{order.partner.name}</LocaleText> : undefined}
      secondary={phone ? <SemanticValue kind="phone">{phone}</SemanticValue> : undefined}
    />
  );
}

export function StoreOrderDateCell({ order }: { order: StoreOrderRow }) {
  const dateLabel = formatDate(order.orderDate);
  const timeLabel = hasClockTime(order.orderDate) ? formatTime(order.orderDate) : undefined;
  return (
    <StackedCell
      primary={dateLabel ? <SemanticValue kind="date">{dateLabel}</SemanticValue> : undefined}
      secondary={timeLabel ? <SemanticValue kind="date">{timeLabel}</SemanticValue> : undefined}
    />
  );
}

type Translate = (key: MessageKey) => string;

/**
 * The Payment cell as plain text (print / preview): the same Finance label,
 * order total and Sales declaration the cell shows.
 */
export function storeOrderPaymentText(order: StoreOrderRow, t: Translate): string {
  const declared = order.declaredPaymentStatus ?? "UNPAID";
  const declaredAmount = Number(order.declaredAmount ?? 0);
  return [
    t(financialStatusLabelKey(order.paymentStatus, order.paymentType)),
    formatMoney(order.total ?? "0", currencyCodeOf(order.currency)),
    declared !== "UNPAID"
      ? `${t(declaredShortLabelKey(declared))}${
          declared === "PARTIALLY_PAID" && declaredAmount > 0
            ? ` ${formatMoney(declaredAmount)}`
            : ""
        }`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The Shipping cell's status label: the catalog status the screen shows, else the stage label. */
export function storeOrderShippingLabel(order: StoreOrderRow, t: Translate): string {
  return (
    shippingStatusName(order.shippingStatus, t) ?? t(SHIPPING_STAGE_LABEL_KEY[order.shippingStage])
  );
}

/** The Shipping cell as plain text (print / preview): status label and tracking number. */
export function storeOrderShippingText(order: StoreOrderRow, t: Translate): string {
  const tracking = latestShipment(order)?.trackingNumber;
  return [storeOrderShippingLabel(order, t), tracking].filter(Boolean).join(" · ");
}

/**
 * One badge per status column (design-system §6): the Finance verification
 * state is the badge; the order total and what Sales declared sit on the
 * caption line. Payment stays separate from shipping (its own column).
 */
export function StoreOrderPaymentCell({ order }: { order: StoreOrderRow }) {
  const { t } = useLocale();
  const declared = order.declaredPaymentStatus ?? "UNPAID";
  const declaredLabel = t(declaredShortLabelKey(declared));
  const declaredAmount = Number(order.declaredAmount ?? 0);
  return (
    <StackedCell
      primary={
        <StatusBadge
          label={t(financialStatusLabelKey(order.paymentStatus, order.paymentType))}
          tone={PAYMENT_STATUS_TONE[order.paymentStatus]}
        />
      }
      secondary={
        <span className="inline-flex min-w-0 max-w-full items-baseline gap-1">
          <MoneyValue
            value={order.total ?? "0"}
            currency={order.currency}
            className="shrink-0 font-normal"
          />
          {declared !== "UNPAID" ? (
            <span className="min-w-0 truncate" title={declaredLabel}>
              {"· "}
              {declaredLabel}
              {declared === "PARTIALLY_PAID" && declaredAmount > 0 ? (
                <>
                  {" "}
                  <span className="num">{formatMoney(declaredAmount)}</span>
                </>
              ) : null}
            </span>
          ) : null}
        </span>
      }
    />
  );
}

export function StoreOrderShippingCell({ order }: { order: StoreOrderRow }) {
  const { t } = useLocale();
  const tracking = latestShipment(order)?.trackingNumber;
  const catalog = order.shippingStatus;
  return (
    <StackedCell
      primary={
        <StatusBadge
          label={storeOrderShippingLabel(order, t)}
          tone={
            catalog ? catalogStatusTone(catalog.color) : SHIPPING_STAGE_TONE[order.shippingStage]
          }
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
