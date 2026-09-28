"use client";

import {
  WorkflowTracks,
  type WorkflowTrack,
  type WorkflowTrackerTone,
} from "@/components/shared/workflow-tracker";
import { declaredShortLabelKey } from "@/components/payments/declaration/declaration-status";
import type { StatusTone } from "@/components/business/status-badge";
import {
  FULFILLMENT_METHOD_LABEL_KEY,
  PAYMENT_STATUS_LABEL_KEY,
  PAYMENT_STATUS_TONE,
  PAYMENT_TYPE_LABEL_KEY,
  SHIPPING_STAGE_LABEL_KEY,
  financialStatusLabelKey,
} from "@/config/store-orders/status";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";
import { useLocale } from "@/providers/locale-provider";
import type { StoreOrderPaymentStatusValue, StoreOrderRow } from "@/services/store-orders-service";

/** Tone for a fulfillment catalog status, by its stable code (the catalog has no color). */
function fulfillmentStatusTone(code: string | null | undefined): StatusTone {
  if (!code) return "neutral";
  if (["DELIVERED", "COLLECTED", "COMPLETED", "FULFILLED"].includes(code)) return "success";
  if (["CANCELLED", "RETURNED", "DELIVERY_FAILED", "FAILED"].includes(code)) return "destructive";
  if (code.startsWith("AWAITING") || code === "NEW" || code === "PENDING") return "neutral";
  return "info";
}

/** Where a track is, in codes only (labels are added by the component). */
export interface TrackPosition {
  stages: readonly string[];
  /** Stages a record may skip — shown only while current (no status history to prove them). */
  optional: readonly string[];
  current: string | null;
  currentComplete: boolean;
  /** Off-path code (pre-start, branch or terminal), shown as the current state. */
  stateCode: string | null;
  /** Where that state sits: before the path, inline at the reached point, or after it. */
  statePlacement?: "before" | "inline" | "after";
}

/**
 * Finance-verified payment (`StoreOrder.paymentStatus`). Happy path:
 * PAYMENT_PENDING → (PARTIALLY_PAID, optional) → FULLY_PAID_RECONCILED.
 * Every order is created PAYMENT_PENDING, so that stage is always passed;
 * OVERPAID, PAYMENT_REVIEW and UNMATCHED are off-path states after it.
 */
export const STORE_ORDER_PAYMENT_STAGES = [
  "PAYMENT_PENDING",
  "PARTIALLY_PAID",
  "FULLY_PAID_RECONCILED",
] as const;

export function storeOrderPaymentTrack(status: StoreOrderPaymentStatusValue): TrackPosition {
  const stages = STORE_ORDER_PAYMENT_STAGES;
  const optional = ["PARTIALLY_PAID"];
  switch (status) {
    case "PAYMENT_PENDING":
    case "PARTIALLY_PAID":
      return { stages, optional, current: status, currentComplete: false, stateCode: null };
    case "FULLY_PAID_RECONCILED":
      return { stages, optional, current: status, currentComplete: true, stateCode: null };
    default:
      return {
        stages,
        optional,
        current: "PAYMENT_PENDING",
        currentComplete: true,
        stateCode: status,
        // Review / unmatched sit between pending and fully paid; overpaid is past it.
        statePlacement: status === "OVERPAID" ? "after" : "inline",
      };
  }
}

/**
 * Order fulfillment (`StoreOrder.fulfillmentStatus.code`, a FULFILLMENT
 * StatusDefinition). Shipping: (READY, optional — orders can start
 * UNFULFILLED) → SHIPPED → DELIVERED (shipments sync SHIPPED/DELIVERED; a
 * delivery implies the goods shipped). Pickup: AWAITING_PREPARATION → READY_FOR_PICKUP →
 * COLLECTED (RETURNED only from COLLECTED). With no status row the API's own
 * fallbacks apply (pickup → AWAITING_PREPARATION; shipping stage NOT_READY →
 * UNFULFILLED, READY_FOR_SHIPPING → READY).
 */
export const STORE_ORDER_SHIPPING_STAGES = ["READY", "SHIPPED", "DELIVERED"] as const;
export const STORE_ORDER_PICKUP_STAGES = [
  "AWAITING_PREPARATION",
  "READY_FOR_PICKUP",
  "COLLECTED",
] as const;

export function storeOrderFulfillmentCode(
  order: Pick<StoreOrderRow, "fulfillmentStatus" | "fulfillmentMethod" | "shippingStage">,
): string {
  if (order.fulfillmentStatus?.code) return order.fulfillmentStatus.code;
  if (order.fulfillmentMethod === "PICKUP") return "AWAITING_PREPARATION";
  return order.shippingStage === "READY_FOR_SHIPPING" ? "READY" : "UNFULFILLED";
}

export function storeOrderFulfillmentTrack(
  order: Pick<StoreOrderRow, "fulfillmentStatus" | "fulfillmentMethod" | "shippingStage">,
): TrackPosition {
  const pickup = order.fulfillmentMethod === "PICKUP";
  const stages: readonly string[] = pickup
    ? STORE_ORDER_PICKUP_STAGES
    : STORE_ORDER_SHIPPING_STAGES;
  const optional = pickup ? [] : ["READY"];
  const code = storeOrderFulfillmentCode(order);
  const last = stages[stages.length - 1];
  if (stages.includes(code)) {
    return { stages, optional, current: code, currentComplete: code === last, stateCode: null };
  }
  // Pickup RETURNED is only allowed from COLLECTED (API transitionPickup).
  if (pickup && code === "RETURNED") {
    return { stages, optional, current: last, currentComplete: true, stateCode: code };
  }
  return {
    stages,
    optional,
    current: null,
    currentComplete: false,
    stateCode: code,
    // UNFULFILLED / AWAITING_* come before the first stage; PROCESSING is on
    // the way; CANCELLED / FAILED / RETURNED are terminal.
    statePlacement:
      code === "UNFULFILLED" || code.startsWith("AWAITING")
        ? "before"
        : code === "PROCESSING"
          ? "inline"
          : "after",
  };
}

/**
 * The store order's two independent lifecycles as read-only
 * trackers — Payment (Finance-verified, with what Sales declared as context)
 * and Fulfillment (order fulfillment, with the carrier status as context).
 * Payment never advances fulfillment and vice versa (OMS business rules).
 */
export function StoreOrderWorkflowTracks({
  order,
  className,
}: {
  order: StoreOrderRow;
  className?: string;
}) {
  const { t, locale } = useLocale();

  const payment = storeOrderPaymentTrack(order.paymentStatus);
  const paymentTrack: WorkflowTrack = {
    key: "payment",
    label: t("workflowTracker.payment"),
    fullFrom: "3xl",
    stages: payment.stages.map((code) => ({
      key: code,
      optional: payment.optional.includes(code),
      label:
        code === "PAYMENT_PENDING" && payment.current === code
          ? t(financialStatusLabelKey(code, order.paymentType))
          : code === "FULLY_PAID_RECONCILED"
            ? // Same wording as the header's settled badge.
              t("storeOrders.detail.payments.settled")
            : t(PAYMENT_STATUS_LABEL_KEY[code as StoreOrderPaymentStatusValue]),
    })),
    current: payment.current,
    currentComplete: payment.currentComplete,
    state: payment.stateCode
      ? {
          label: t(PAYMENT_STATUS_LABEL_KEY[payment.stateCode as StoreOrderPaymentStatusValue]),
          tone: PAYMENT_STATUS_TONE[payment.stateCode as StoreOrderPaymentStatusValue],
          placement: payment.statePlacement,
        }
      : null,
    meta: [
      t("workflowTracker.declaredMeta", {
        status: t(declaredShortLabelKey(order.declaredPaymentStatus)),
      }),
      t(PAYMENT_TYPE_LABEL_KEY[order.paymentType ?? "PREPAID"]),
    ].join(" · "),
  };

  const pickup = order.fulfillmentMethod === "PICKUP";
  const fulfillment = storeOrderFulfillmentTrack(order);
  const shipment = order.shipments?.[0] ?? null;
  const stageCaption = (code: string): string | null => {
    if (pickup || !shipment) return null;
    if (code === "SHIPPED") return shipment.shippedAt ? formatDate(shipment.shippedAt) : null;
    if (code === "DELIVERED") return shipment.deliveredAt ? formatDate(shipment.deliveredAt) : null;
    return null;
  };
  const statusName = order.fulfillmentStatus
    ? locale === "en" && order.fulfillmentStatus.nameEn
      ? order.fulfillmentStatus.nameEn
      : order.fulfillmentStatus.name
    : null;
  const stateTone: WorkflowTrackerTone =
    fulfillment.stateCode === "UNFULFILLED"
      ? "neutral"
      : fulfillmentStatusTone(fulfillment.stateCode);
  const fulfillmentTrack: WorkflowTrack = {
    key: "fulfillment",
    label: t("workflowTracker.fulfillment"),
    fullFrom: "2xl",
    stages: fulfillment.stages.map((code) => ({
      key: code,
      optional: fulfillment.optional.includes(code),
      label: t(`workflowTracker.fulfillmentStage.${code}` as MessageKey),
      caption: stageCaption(code),
    })),
    current: fulfillment.current,
    currentComplete: fulfillment.currentComplete,
    state: fulfillment.stateCode
      ? {
          // No status row: the API's shipping-stage fallback (NOT_READY) names it.
          label: statusName ?? t(SHIPPING_STAGE_LABEL_KEY[order.shippingStage]),
          tone: stateTone,
          placement: fulfillment.statePlacement,
        }
      : null,
    meta: pickup
      ? t(FULFILLMENT_METHOD_LABEL_KEY.PICKUP)
      : order.shippingStatus?.name
        ? t("workflowTracker.shippingMeta", { status: order.shippingStatus.name })
        : null,
  };

  return (
    <WorkflowTracks
      label={t("workflowTracker.group")}
      tracks={[paymentTrack, fulfillmentTrack]}
      className={className}
    />
  );
}
