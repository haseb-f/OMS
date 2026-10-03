import type { StatusTone } from "@/components/business/status-tone";

/**
 * The fulfilment-lifecycle state an order card is coloured by (R7 Grid view).
 * Payment is a separate axis and keeps its own badge — nothing here reads it.
 * Works on the company row and the agent-portal row alike (structural input).
 */
export type OrderWorkflowState =
  "pending" | "readyToShip" | "shipped" | "delivered" | "returned" | "cancelled";

export const ORDER_WORKFLOW_STATE_TONE: Record<OrderWorkflowState, StatusTone> = {
  pending: "neutral",
  readyToShip: "warning",
  shipped: "info",
  delivered: "success",
  returned: "destructive",
  cancelled: "neutral",
};

export interface OrderStateInput {
  /** Fulfillment StatusDefinition code (company: `storeOrderFulfillmentCode`). */
  fulfillmentCode?: string | null;
  /** Latest shipment attempt's status, when the row carries shipments. */
  shipmentStatus?: string | null;
  shippingStage?: "NOT_READY" | "READY_FOR_SHIPPING" | null;
}

const DELIVERED_CODES = new Set(["DELIVERED", "COLLECTED", "COMPLETED", "FULFILLED"]);
const READY_CODES = new Set(["READY", "READY_FOR_PICKUP", "READY_FOR_SHIPPING"]);

export function orderWorkflowState(order: OrderStateInput): OrderWorkflowState {
  const code = order.fulfillmentCode ?? "";
  const shipment = order.shipmentStatus ?? "";
  if (code === "CANCELLED") return "cancelled";
  // A failed delivery is goods coming back: it reads with Returned.
  if (code === "RETURNED" || shipment === "DELIVERY_FAILED" || shipment === "NEEDS_RESHIPMENT") {
    return "returned";
  }
  if (DELIVERED_CODES.has(code) || shipment === "DELIVERED") return "delivered";
  if (code === "SHIPPED" || shipment === "SHIPPED" || shipment === "OUT_FOR_DELIVERY") {
    return "shipped";
  }
  if (
    order.shippingStage === "READY_FOR_SHIPPING" ||
    READY_CODES.has(code) ||
    shipment === "READY_FOR_SHIPPING" ||
    shipment === "LABEL_CREATED"
  ) {
    return "readyToShip";
  }
  return "pending";
}
