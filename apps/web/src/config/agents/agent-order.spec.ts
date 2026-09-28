import { describe, expect, it } from "vitest";
import {
  agentOrderBreakdown,
  buildReturnLines,
  defaultChargeReturnFee,
  isReturnShipment,
  returnShipmentChoices,
  returnedQuantities,
} from "./agent-order";

describe("agentOrderBreakdown", () => {
  it("is null for orders without a pricing mode (legacy / company)", () => {
    expect(agentOrderBreakdown({ pricingMode: null })).toBeNull();
    expect(agentOrderBreakdown({})).toBeNull();
  });

  it("mode A — shipping added: payable is the stored total", () => {
    expect(
      agentOrderBreakdown({
        pricingMode: "SHIPPING_ADDED",
        merchandiseAmount: "1000.00",
        discountAmount: "50.00",
        taxAmount: "0.00",
        shippingCharge: "100.00",
        shippingChargeSource: "RATE",
        shippingRateAmount: "100.00",
        serviceCharge: "0.00",
        payableTotal: "1100.00",
      }),
    ).toEqual({
      mode: "SHIPPING_ADDED",
      merchandise: 1000,
      discount: 50,
      tax: 0,
      shipping: 100,
      shippingSource: "RATE",
      shippingRate: 100,
      shippingOverrideReason: null,
      service: 0,
      payable: 1100,
    });
  });

  it("mode B — shipping included, manual shipping keeps the configured rate", () => {
    const result = agentOrderBreakdown({
      pricingMode: "SHIPPING_INCLUDED",
      merchandiseAmount: "880.00",
      shippingCharge: "120.00",
      shippingChargeSource: "MANUAL",
      shippingRateAmount: "100.00",
      shippingOverrideReason: "Remote area",
      serviceCharge: null,
      payableTotal: null,
    });
    expect(result?.payable).toBe(1000);
    expect(result?.shippingRate).toBe(100);
    expect(result?.shippingOverrideReason).toBe("Remote area");
  });
});

describe("agent returns", () => {
  const items = [
    { id: "a", quantity: 3 },
    { id: "b", quantity: 1 },
  ];

  it("sums quantities already received back per line", () => {
    expect(
      returnedQuantities([
        { lines: [{ storeOrderItemId: "a", productId: "p", quantity: 1 }] },
        { lines: [{ storeOrderItemId: "a", productId: "p", quantity: 1 }] },
      ]),
    ).toEqual({ a: 2 });
  });

  it("builds lines, skipping blanks and rejecting fractions or more than remains", () => {
    expect(buildReturnLines(items, { a: "2", b: "" }, {})).toEqual({
      lines: [{ storeOrderItemId: "a", quantity: 2 }],
      errors: {},
    });
    expect(buildReturnLines(items, { a: "1.5", b: "1" }, { b: 1 })).toEqual({
      lines: [],
      errors: { a: "notInteger", b: "exceedsRemaining" },
    });
  });
});

describe("return receipt shipment and fee", () => {
  const shipped = { id: "s1", status: "DELIVERED", shippingStatus: { code: "DELIVERED" } };
  const back = { id: "s2", status: "RETURN_AFTER_DELIVERY", shippingStatus: null };
  const carrierBack = {
    id: "s3",
    status: "SHIPPED",
    shippingStatus: { code: "returned_to_sender" },
  };

  it("recognises returned shipments", () => {
    expect(isReturnShipment(shipped)).toBe(false);
    expect(isReturnShipment(back)).toBe(true);
    expect(isReturnShipment(carrierBack)).toBe(true);
  });

  it("offers returned shipments, else every shipment", () => {
    expect(returnShipmentChoices([shipped, back]).map((s) => s.id)).toEqual(["s2"]);
    expect(returnShipmentChoices([shipped]).map((s) => s.id)).toEqual(["s1"]);
  });

  it("defaults the fee per the API rule", () => {
    expect(defaultChargeReturnFee("s2", 3)).toBe(true);
    expect(defaultChargeReturnFee(null, 0)).toBe(true);
    expect(defaultChargeReturnFee(null, 1)).toBe(false);
  });
});
