import { describe, expect, it } from "vitest";
import { companyOrderNextAction, portalOrderNextAction } from "./order-list-next-action";
import type { StoreOrderRow } from "@/services/store-orders-service";
import type { PortalOrderRow } from "@/services/agent-portal-service";

const NO_PERMISSIONS = {
  reviewDuplicates: false,
  confirmCustomerTotal: false,
  setAmounts: false,
  declarePayment: false,
  manageShipping: false,
  recordPickup: false,
  generateInvoice: false,
};

const company = (over: Partial<StoreOrderRow>): StoreOrderRow =>
  ({
    id: "o1",
    internalOrderId: "ORD-1",
    paymentType: "PREPAID",
    paymentStatus: "PAYMENT_PENDING",
    declaredPaymentStatus: "UNPAID",
    shippingStage: "NOT_READY",
    fulfillmentMethod: "SHIPPING",
    total: "100",
    ...over,
  }) as StoreOrderRow;

describe("companyOrderNextAction (list rows reuse the detail page rules)", () => {
  it("prepaid, unpaid, can declare -> declare payment", () => {
    expect(
      companyOrderNextAction(company({}), { ...NO_PERMISSIONS, declarePayment: true }).kind,
    ).toBe("DECLARE_PAYMENT");
  });

  it("prepaid, unpaid, cannot declare -> awaiting Finance (not actionable)", () => {
    const next = companyOrderNextAction(company({}), NO_PERMISSIONS);
    expect(next.kind).toBe("AWAITING_FINANCE");
    expect(next.actionable).toBe(false);
  });

  it("COD with shipping permission and no shipment -> assign shipping", () => {
    expect(
      companyOrderNextAction(company({ paymentType: "CASH_ON_DELIVERY" }), {
        ...NO_PERMISSIONS,
        manageShipping: true,
      }).kind,
    ).toBe("ASSIGN_SHIPPING");
  });

  it("cancelled orders have no next action", () => {
    expect(
      companyOrderNextAction(
        company({ fulfillmentStatus: { id: "f", code: "CANCELLED", name: "x" } }),
        { ...NO_PERMISSIONS, manageShipping: true },
      ).kind,
    ).toBe("NONE");
  });
});

describe("portalOrderNextAction", () => {
  const portal = (over: Partial<PortalOrderRow>): PortalOrderRow =>
    ({
      paymentType: "PREPAID",
      declaredPaymentStatus: "UNPAID",
      financePaymentStatus: "PAYMENT_PENDING",
      fulfillmentMethod: "SHIPPING",
      fulfillmentStatus: null,
      breakdown: { payableTotal: 250 },
      ...over,
    }) as PortalOrderRow;

  it("lets an agent who may declare payments do so, else waits on Finance", () => {
    expect(portalOrderNextAction(portal({}), { declarePayment: true }).kind).toBe(
      "DECLARE_PAYMENT",
    );
    expect(portalOrderNextAction(portal({}), { declarePayment: false }).kind).toBe(
      "AWAITING_FINANCE",
    );
  });

  it("never offers staff-only steps (shipping, invoice)", () => {
    const kind = portalOrderNextAction(portal({ paymentType: "CASH_ON_DELIVERY" }), {
      declarePayment: true,
    }).kind;
    expect(["ASSIGN_SHIPPING", "GENERATE_INVOICE", "MARK_HANDED_OVER"]).not.toContain(kind);
  });
});
