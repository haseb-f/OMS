import type { StatusTone } from "@/components/business/status-badge";
import type {
  StoreOrderPaymentStatusValue,
  StoreOrderShippingStageValue,
} from "@/services/store-orders-service";
import type { MessageKey } from "@/i18n/translate";

export const PAYMENT_STATUS_LABEL_KEY: Record<StoreOrderPaymentStatusValue, MessageKey> = {
  PAYMENT_PENDING: "storeOrders.paymentStatus.PAYMENT_PENDING",
  PARTIALLY_PAID: "storeOrders.paymentStatus.PARTIALLY_PAID",
  FULLY_PAID_RECONCILED: "storeOrders.paymentStatus.FULLY_PAID_RECONCILED",
  OVERPAID: "storeOrders.paymentStatus.OVERPAID",
  UNMATCHED: "storeOrders.paymentStatus.UNMATCHED",
  PAYMENT_REVIEW: "storeOrders.paymentStatus.PAYMENT_REVIEW",
};

export const PAYMENT_STATUS_TONE: Record<StoreOrderPaymentStatusValue, StatusTone> = {
  PAYMENT_PENDING: "neutral",
  PARTIALLY_PAID: "warning",
  FULLY_PAID_RECONCILED: "success",
  OVERPAID: "info",
  UNMATCHED: "destructive",
  PAYMENT_REVIEW: "warning",
};

export const PAYMENT_STATUS_VALUES: StoreOrderPaymentStatusValue[] = [
  "PAYMENT_PENDING",
  "PARTIALLY_PAID",
  "FULLY_PAID_RECONCILED",
  "OVERPAID",
  "UNMATCHED",
  "PAYMENT_REVIEW",
];

/**
 * Status of an individual Payment record attached to an order (Prisma
 * `PaymentStatus`), which is a different enum from the order-level
 * reconciliation status above. Kept here so the detail table renders a
 * `StatusBadge` like every other status in the product instead of printing
 * the raw enum value.
 */
const PAYMENT_RECORD_STATUS_VALUES = ["PENDING", "MATCHED", "VERIFIED", "REJECTED"] as const;

type PaymentRecordStatusValue = (typeof PAYMENT_RECORD_STATUS_VALUES)[number];

const PAYMENT_RECORD_STATUS_LABEL_KEY: Record<PaymentRecordStatusValue, MessageKey> = {
  PENDING: "storeOrders.detail.payments.recordStatus.PENDING",
  MATCHED: "storeOrders.detail.payments.recordStatus.MATCHED",
  VERIFIED: "storeOrders.detail.payments.recordStatus.VERIFIED",
  REJECTED: "storeOrders.detail.payments.recordStatus.REJECTED",
};

const PAYMENT_RECORD_STATUS_TONE: Record<PaymentRecordStatusValue, StatusTone> = {
  PENDING: "neutral",
  MATCHED: "info",
  VERIFIED: "success",
  REJECTED: "destructive",
};

function isPaymentRecordStatus(value: string): value is PaymentRecordStatusValue {
  return (PAYMENT_RECORD_STATUS_VALUES as readonly string[]).includes(value);
}

/** The API types this field as a plain string, so unknown values fall back to the raw value with a neutral tone rather than crashing the detail page. */
export function paymentRecordStatusBadge(status: string): {
  labelKey: MessageKey | null;
  fallback: string;
  tone: StatusTone;
} {
  if (!isPaymentRecordStatus(status)) {
    return { labelKey: null, fallback: status, tone: "neutral" };
  }
  return {
    labelKey: PAYMENT_RECORD_STATUS_LABEL_KEY[status],
    fallback: status,
    tone: PAYMENT_RECORD_STATUS_TONE[status],
  };
}

export const SHIPPING_STAGE_LABEL_KEY: Record<StoreOrderShippingStageValue, MessageKey> = {
  NOT_READY: "storeOrders.shippingStage.NOT_READY",
  READY_FOR_SHIPPING: "storeOrders.shippingStage.READY_FOR_SHIPPING",
};

export const SHIPPING_STAGE_TONE: Record<StoreOrderShippingStageValue, StatusTone> = {
  NOT_READY: "neutral",
  READY_FOR_SHIPPING: "success",
};

export const SHIPPING_STAGE_VALUES: StoreOrderShippingStageValue[] = [
  "NOT_READY",
  "READY_FOR_SHIPPING",
];

/** "Ready for Shipping" is only reachable once payment is fully reconciled — every Shipping entry point/action gates on this, never just the stage flag alone. */
export function isReadyForShipping(paymentStatus: StoreOrderPaymentStatusValue): boolean {
  return paymentStatus === "FULLY_PAID_RECONCILED";
}
