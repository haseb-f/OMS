import type { StatusTone } from "@/components/business/status-badge";
import { paymentTerm } from "@/config/payments/payment-vocabulary";
import { shipmentStatusLabelKey, shipmentStatusTone } from "@/config/shipping/shipment-status";
import {
  PAYMENT_STATUS_LABEL_KEY,
  PAYMENT_STATUS_TONE,
  financialStatusLabelKey,
} from "@/config/store-orders/status";
import type { MessageKey } from "@/i18n/translate";
import type {
  ShipmentStatusValue,
  StoreOrderPaymentStatusValue,
} from "@/services/store-orders-service";

/**
 * Round 5 Spec 1C — the two independent header badges of an order: Payment
 * (declared → confirmed → settled, in the one payment vocabulary of spec 3A)
 * and Fulfillment. Pure mapping — swapping a label or tone happens here only.
 */
export interface OrderBadge {
  /** i18n key; null when `label` (a catalog name) is the text. */
  labelKey: MessageKey | null;
  label?: string;
  tone: StatusTone;
}

export function orderPaymentBadge(order: {
  paymentStatus: StoreOrderPaymentStatusValue | string;
  declaredPaymentStatus?: "UNPAID" | "PARTIALLY_PAID" | "PAID" | null;
  paymentType?: "PREPAID" | "CASH_ON_DELIVERY" | null;
  /** Confirmed payments' settlement state (internal detail only). */
  payments?: Array<{ status: string; settlementStatus?: string | null }>;
}): OrderBadge {
  const status = order.paymentStatus as StoreOrderPaymentStatusValue;
  if (status === "FULLY_PAID_RECONCILED") {
    const confirmed = (order.payments ?? []).filter((p) => p.status === "VERIFIED");
    const settled =
      confirmed.length > 0 && confirmed.every((p) => p.settlementStatus === "SETTLED");
    const term = paymentTerm(settled ? "SETTLED" : "CONFIRMED");
    return { labelKey: term.labelKey, tone: term.tone };
  }
  if (status === "PAYMENT_PENDING") {
    if (
      order.declaredPaymentStatus === "PAID" ||
      order.declaredPaymentStatus === "PARTIALLY_PAID"
    ) {
      const term = paymentTerm("DECLARED");
      return { labelKey: term.labelKey, tone: term.tone };
    }
    return {
      labelKey: financialStatusLabelKey(status, order.paymentType ?? null),
      tone: "neutral",
    };
  }
  if (status in PAYMENT_STATUS_LABEL_KEY) {
    return { labelKey: PAYMENT_STATUS_LABEL_KEY[status], tone: PAYMENT_STATUS_TONE[status] };
  }
  return { labelKey: null, label: String(order.paymentStatus), tone: "neutral" };
}

/** Tone for a fulfillment catalog status, by its stable code (the catalog has no color). */
export function fulfillmentStatusTone(code: string | null | undefined): StatusTone {
  if (!code) return "neutral";
  if (["DELIVERED", "COLLECTED", "COMPLETED", "FULFILLED"].includes(code)) return "success";
  if (["CANCELLED", "RETURNED", "DELIVERY_FAILED", "FAILED"].includes(code)) return "destructive";
  if (code.startsWith("AWAITING") || code === "NEW" || code === "PENDING") return "neutral";
  return "info";
}

/**
 * Shipping orders with a shipment show the latest attempt's operational
 * status; otherwise (pickup, no shipment yet) the order's fulfillment status.
 */
export function orderFulfillmentBadge(order: {
  fulfillmentMethod?: "SHIPPING" | "PICKUP" | null;
  fulfillmentStatus?: { code: string; name: string; nameEn?: string | null } | null;
  latestShipmentStatus?: ShipmentStatusValue | string | null;
  locale: "ar" | "en";
}): OrderBadge {
  if (order.fulfillmentMethod !== "PICKUP" && order.latestShipmentStatus) {
    const status = order.latestShipmentStatus as ShipmentStatusValue;
    return { labelKey: shipmentStatusLabelKey(status), tone: shipmentStatusTone(status) };
  }
  const status = order.fulfillmentStatus;
  if (!status) return { labelKey: "storeOrders.shippingStage.NOT_READY", tone: "neutral" };
  return {
    labelKey: null,
    label: order.locale === "en" && status.nameEn ? status.nameEn : status.name,
    tone: fulfillmentStatusTone(status.code),
  };
}
