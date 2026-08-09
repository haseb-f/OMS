import type { StatusTone } from "@/components/business/status-badge";
import type { SalesDocumentStatusOption } from "@/components/sales";
import type { SalesDocumentStatusValue } from "@/services/sales-orders-service";
import type { MessageKey } from "@/i18n/translate";

export const ORDER_STATUS_LABEL_KEY: Record<SalesDocumentStatusValue, MessageKey> = {
  DRAFT: "sales.orders.status.draft",
  PENDING_APPROVAL: "sales.orders.status.submitted",
  APPROVED: "sales.orders.status.approved",
  CONFIRMED: "sales.orders.status.confirmed",
  PARTIALLY_DELIVERED: "sales.orders.status.partiallyDelivered",
  DELIVERED: "sales.orders.status.delivered",
  CANCELLED: "sales.orders.status.cancelled",
  CLOSED: "sales.orders.status.closed",
};

export const ORDER_STATUS_TONE: Record<SalesDocumentStatusValue, StatusTone> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  CONFIRMED: "success",
  PARTIALLY_DELIVERED: "warning",
  DELIVERED: "success",
  CANCELLED: "destructive",
  CLOSED: "info",
};

export function buildOrderStatusOptions(
  t: (key: MessageKey) => string,
): SalesDocumentStatusOption[] {
  return (Object.keys(ORDER_STATUS_LABEL_KEY) as SalesDocumentStatusValue[]).map((value) => ({
    value,
    label: t(ORDER_STATUS_LABEL_KEY[value]),
    tone: ORDER_STATUS_TONE[value],
  }));
}

export const ORDER_FILTERABLE_STATUSES: SalesDocumentStatusValue[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "CONFIRMED",
  "PARTIALLY_DELIVERED",
  "DELIVERED",
  "CANCELLED",
];

/** Mirrors SalesOrdersService.cancel's allowed-from set — Order alone can still be cancelled from Confirmed (releases the reservation). */
export const ORDER_CANCELLABLE_STATUSES: SalesDocumentStatusValue[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "CONFIRMED",
];

/** Mirrors SalesOrdersService.archive's allowed-from set. */
export const ORDER_ARCHIVABLE_STATUSES: SalesDocumentStatusValue[] = [
  "DRAFT",
  "CANCELLED",
  "DELIVERED",
  "CLOSED",
];
