import type { StatusTone } from "@/components/business/status-badge";
import type { ShipmentStatusValue } from "@/services/shipping-service";
import type { MessageKey } from "@/i18n/translate";

/**
 * Canonical shipping-status vocabulary for the OMS UI.
 *
 * `Shipment.status` remains a closed Prisma enum (workflow state machine).
 * `READY_FOR_SHIPPING` is the default initial status — it is the order-level
 * shipping stage before a Shipment row exists, and the first List Sheet
 * value. Do not add a second hardcoded list in individual screens; import
 * this catalog (or `SHIPMENT_STATUS_VALUES` derived from it).
 */
export const SHIPPING_STATUS_CATALOG = [
  {
    code: "READY_FOR_SHIPPING" as const,
    isDefault: true,
    isSystem: true,
  },
  {
    code: "LABEL_CREATED" as const,
    isDefault: false,
    isSystem: true,
  },
  {
    code: "SHIPPED" as const,
    isDefault: false,
    isSystem: true,
  },
  {
    code: "OUT_FOR_DELIVERY" as const,
    isDefault: false,
    isSystem: true,
  },
  {
    code: "DELIVERED" as const,
    isDefault: false,
    isSystem: true,
  },
  {
    code: "DELIVERY_FAILED" as const,
    isDefault: false,
    isSystem: true,
  },
  {
    code: "NEEDS_RESHIPMENT" as const,
    isDefault: false,
    isSystem: true,
  },
] as const;

export const DEFAULT_SHIPPING_STATUS: ShipmentStatusValue = "READY_FOR_SHIPPING";

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
 * freshly-created shipment never crashes the page. Null displays as the
 * default initial status: جاهز للشحن.
 */
export function shipmentStatusLabelKey(status: ShipmentStatusValue | null): MessageKey {
  return status
    ? SHIPMENT_STATUS_LABEL_KEY[status]
    : SHIPMENT_STATUS_LABEL_KEY[DEFAULT_SHIPPING_STATUS];
}

export function shipmentStatusTone(status: ShipmentStatusValue | null): StatusTone {
  return status ? SHIPMENT_STATUS_TONE[status] : SHIPMENT_STATUS_TONE[DEFAULT_SHIPPING_STATUS];
}

export function catalogStatusTone(color: string | null | undefined): StatusTone {
  if (
    color === "success" ||
    color === "warning" ||
    color === "destructive" ||
    color === "info" ||
    color === "neutral"
  ) {
    return color;
  }
  return "neutral";
}

export const SHIPMENT_STATUS_VALUES: ShipmentStatusValue[] = SHIPPING_STATUS_CATALOG.map(
  (status) => status.code,
);
