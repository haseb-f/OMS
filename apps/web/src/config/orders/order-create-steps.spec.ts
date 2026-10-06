import { describe, expect, it } from "vitest";
import { storeOrderCreateDefaultValues } from "@/config/store-orders/store-order-create-schema";
import {
  ORDER_CREATE_STEPS,
  ORDER_CREATE_STEP_FIELDS,
  firstStepWithError,
  orderCreateStepIndex,
  stepForField,
} from "./order-create-steps";

describe("order create steps", () => {
  it("runs customer → products → delivery & payment → review", () => {
    expect(ORDER_CREATE_STEPS).toEqual(["customer", "products", "deliveryPayment", "review"]);
    expect(orderCreateStepIndex("review")).toBe(3);
  });

  it("assigns every form field to exactly one step", () => {
    const owned = ORDER_CREATE_STEPS.flatMap((step) => [...ORDER_CREATE_STEP_FIELDS[step]]);
    expect(new Set(owned).size).toBe(owned.length);
    expect([...owned].sort()).toEqual(Object.keys(storeOrderCreateDefaultValues()).sort());
  });

  it("keeps the customer's identity on step 1 and the order terms on step 3", () => {
    expect(stepForField("customerName")).toBe("customer");
    expect(stepForField("customerPhone")).toBe("customer");
    expect(stepForField("countryId")).toBe("customer");
    expect(stepForField("currencyId")).toBe("deliveryPayment");
    expect(stepForField("deliveryCountryId")).toBe("deliveryPayment");
    expect(stepForField("receiptUrl")).toBe("deliveryPayment");
  });

  it("maps the dialog's own parts and the API's DTO names", () => {
    expect(stepForField("lines")).toBe("products");
    expect(stepForField("items[0].unitPrice")).toBe("products");
    expect(stepForField("items.1.productId")).toBe("products");
    expect(stepForField("partner.phone")).toBe("customer");
    expect(stepForField("duplicates")).toBe("customer");
    expect(stepForField("delivery.city")).toBe("deliveryPayment");
    expect(stepForField("declaration.amount")).toBe("deliveryPayment");
    expect(stepForField("unknownThing")).toBeNull();
  });

  it("returns to the earliest step holding an error", () => {
    expect(firstStepWithError(["currencyId", "items[0].quantity", "notes"])).toBe("products");
    expect(firstStepWithError(["declaration", "customerPhone"])).toBe("customer");
    expect(firstStepWithError(["receipts"])).toBe("deliveryPayment");
    expect(firstStepWithError(["somethingElse"])).toBeNull();
    expect(firstStepWithError([])).toBeNull();
  });
});
