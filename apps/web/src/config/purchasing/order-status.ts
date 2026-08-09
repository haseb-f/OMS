import type { StatusTone } from "@/components/business/status-badge";
import type { PurchaseOrderStatusValue } from "@/services/purchase-orders-service";
import type { MessageKey } from "@/i18n/translate";

/** PurchaseOrder kept its own simpler Phase-1 status set (ADR-0015) — Draft/Approved/Cancelled/Closed only. */
export const ORDER_STATUS_LABEL_KEY: Record<PurchaseOrderStatusValue, MessageKey> = {
  DRAFT: "purchasing.orders.status.draft",
  APPROVED: "purchasing.orders.status.approved",
  CANCELLED: "purchasing.orders.status.cancelled",
  CLOSED: "purchasing.orders.status.closed",
};

export const ORDER_STATUS_TONE: Record<PurchaseOrderStatusValue, StatusTone> = {
  DRAFT: "neutral",
  APPROVED: "success",
  CANCELLED: "destructive",
  CLOSED: "info",
};

export function buildOrderStatusOptions(t: (key: MessageKey) => string) {
  return (Object.keys(ORDER_STATUS_LABEL_KEY) as PurchaseOrderStatusValue[]).map((value) => ({
    value,
    label: t(ORDER_STATUS_LABEL_KEY[value]),
    tone: ORDER_STATUS_TONE[value],
  }));
}

export const ORDER_FILTERABLE_STATUSES: PurchaseOrderStatusValue[] = [
  "DRAFT",
  "APPROVED",
  "CANCELLED",
  "CLOSED",
];
export const ORDER_CANCELLABLE_STATUSES: PurchaseOrderStatusValue[] = ["DRAFT", "APPROVED"];
/** Mirrors PurchaseOrdersService.archive's allowed-from set (TASK-042). */
export const ORDER_ARCHIVABLE_STATUSES: PurchaseOrderStatusValue[] = [
  "DRAFT",
  "CANCELLED",
  "CLOSED",
];
