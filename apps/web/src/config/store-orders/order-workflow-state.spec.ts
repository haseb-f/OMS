import { describe, expect, it } from "vitest";
import { orderWorkflowState } from "./order-workflow-state";

describe("orderWorkflowState", () => {
  it.each([
    [{ fulfillmentCode: "CANCELLED" }, "cancelled"],
    [{ fulfillmentCode: "RETURNED" }, "returned"],
    [{ fulfillmentCode: "UNFULFILLED", shipmentStatus: "DELIVERY_FAILED" }, "returned"],
    [{ fulfillmentCode: "DELIVERED" }, "delivered"],
    [{ fulfillmentCode: "COLLECTED" }, "delivered"],
    [{ fulfillmentCode: "READY", shipmentStatus: "DELIVERED" }, "delivered"],
    [{ fulfillmentCode: "SHIPPED" }, "shipped"],
    [{ fulfillmentCode: "READY", shipmentStatus: "OUT_FOR_DELIVERY" }, "shipped"],
    [{ fulfillmentCode: "UNFULFILLED", shippingStage: "READY_FOR_SHIPPING" }, "readyToShip"],
    [{ fulfillmentCode: "READY_FOR_PICKUP" }, "readyToShip"],
    [{ fulfillmentCode: "UNFULFILLED", shipmentStatus: "LABEL_CREATED" }, "readyToShip"],
    [{ fulfillmentCode: "UNFULFILLED", shippingStage: "NOT_READY" }, "pending"],
    [{}, "pending"],
  ] as const)("%j -> %s", (input, expected) => {
    expect(orderWorkflowState(input)).toBe(expected);
  });

  it("a cancelled order stays cancelled whatever its shipments say", () => {
    expect(orderWorkflowState({ fulfillmentCode: "CANCELLED", shipmentStatus: "DELIVERED" })).toBe(
      "cancelled",
    );
  });
});
