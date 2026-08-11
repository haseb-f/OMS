import type { StatusTone } from "@/components/business/status-badge";
import type { ShipmentStatusValue } from "@/services/shipping-service";
import type { MessageKey } from "@/i18n/translate";

/** The 7-state Shipment lifecycle (ADR — Store Orders + Shipping Operations). DELIVERY_FAILED -> NEEDS_RESHIPMENT always creates a brand-new Shipment row on the same Store Order, never a new order. */
export const SHIPMENT_STATUS_LABEL_KEY: Record<ShipmentStatusValue, MessageKey> = {
  READY_FOR_SHIPPING: "shipping.status.READY_FOR_SHIPPING",
  LABEL_CREATED: "shipping.status.LABEL_CREATED",
  SHIPPED: "shipping.status.SHIPPED",
  OUT_FOR_DELIVERY: "shipping.status.OUT_FOR_DELIVERY",
  DELIVERED: "shipping.status.DELIVERED",
  DELIVERY_FAILED: "shipping.status.DELIVERY_FAILED",
  NEEDS_RESHIPMENT: "shipping.status.NEEDS_RESHIPMENT",
};

export const SHIPMENT_STATUS_TONE: Record<ShipmentStatusValue, StatusTone> = {
  READY_FOR_SHIPPING: "neutral",
  LABEL_CREATED: "info",
  SHIPPED: "info",
  OUT_FOR_DELIVERY: "warning",
  DELIVERED: "success",
  DELIVERY_FAILED: "destructive",
  NEEDS_RESHIPMENT: "warning",
};

/**
 * `Shipment.status` is null until a shipment progresses to LABEL_CREATED
 * (see the `Shipment` schema comment) — every render site must go through
 * these two helpers rather than indexing the maps above directly, so a
 * freshly-created shipment never crashes the page.
 */
export function shipmentStatusLabelKey(status: ShipmentStatusValue | null): MessageKey {
  return status ? SHIPMENT_STATUS_LABEL_KEY[status] : "shipping.status.READY_FOR_SHIPPING";
}

export function shipmentStatusTone(status: ShipmentStatusValue | null): StatusTone {
  return status ? SHIPMENT_STATUS_TONE[status] : "neutral";
}

export const SHIPMENT_STATUS_VALUES: ShipmentStatusValue[] = [
  "READY_FOR_SHIPPING",
  "LABEL_CREATED",
  "SHIPPED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "DELIVERY_FAILED",
  "NEEDS_RESHIPMENT",
];
