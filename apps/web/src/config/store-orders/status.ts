import type { StatusTone } from "@/components/business/status-badge";
import { paymentRecordTerm, paymentTerm } from "@/config/payments/payment-vocabulary";
import type {
  StoreOrderPaymentStatusValue,
  StoreOrderPaymentTypeValue,
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

export const PAYMENT_TYPE_LABEL_KEY: Record<StoreOrderPaymentTypeValue, MessageKey> = {
  PREPAID: "storeOrders.paymentType.PREPAID",
  CASH_ON_DELIVERY: "storeOrders.paymentType.CASH_ON_DELIVERY",
};

export const PAYMENT_TYPE_VALUES: StoreOrderPaymentTypeValue[] = ["PREPAID", "CASH_ON_DELIVERY"];

export const FULFILLMENT_METHOD_LABEL_KEY: Record<"SHIPPING" | "PICKUP", MessageKey> = {
  SHIPPING: "storeOrders.fulfillmentMethod.SHIPPING",
  PICKUP: "storeOrders.fulfillmentMethod.PICKUP",
};

/**
 * Status of an individual Payment record attached to an order (Prisma
 * `PaymentStatus`), which is a different enum from the order-level
 * reconciliation status above. Kept here so the detail table renders a
 * `StatusBadge` like every other status in the product instead of printing
 * the raw enum value.
 */
/** The API types this field as a plain string, so unknown values fall back to the raw value with a neutral tone rather than crashing the detail page. Labels and tones come from the one payment vocabulary. */
export function paymentRecordStatusBadge(status: string): {
  labelKey: MessageKey | null;
  fallback: string;
  tone: StatusTone;
} {
  const term = paymentRecordTerm(status);
  if (!term) return { labelKey: null, fallback: status, tone: "neutral" };
  const definition = paymentTerm(term);
  return { labelKey: definition.labelKey, fallback: status, tone: definition.tone };
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

/** Payment Type is not financial confirmation — pending prepaid awaits match; COD awaits collection. */
export function financialStatusLabelKey(
  paymentStatus: StoreOrderPaymentStatusValue,
  paymentType?: StoreOrderPaymentTypeValue | null,
): MessageKey {
  if (paymentStatus === "PAYMENT_PENDING") {
    return paymentType === "CASH_ON_DELIVERY"
      ? "storeOrders.paymentStatus.AWAITING_COLLECTION"
      : "storeOrders.paymentStatus.AWAITING_RECONCILIATION";
  }
  return PAYMENT_STATUS_LABEL_KEY[paymentStatus];
}
