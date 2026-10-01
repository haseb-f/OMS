import { describe, expect, it } from "vitest";
import { computeNextAction, type NextActionInput } from "./next-action";
import { orderFulfillmentBadge, orderPaymentBadge } from "./order-status-badges";

const all = {
  reviewDuplicates: true,
  confirmCustomerTotal: true,
  setAmounts: true,
  declarePayment: true,
  manageShipping: true,
  recordPickup: true,
  generateInvoice: true,
};

const base = (over: Partial<NextActionInput> = {}): NextActionInput => ({
  total: 100,
  isAgentOrder: false,
  paymentType: "PREPAID",
  declaredPaymentStatus: "UNPAID",
  paymentStatus: "PAYMENT_PENDING",
  fulfillmentMethod: "SHIPPING",
  fulfillmentCode: "READY",
  latestShipment: null,
  duplicateReviewPending: false,
  customerTotalConfirmationRequired: false,
  hasActiveInvoice: false,
  canDeclareMore: true,
  can: all,
  ...over,
});

const kind = (over: Partial<NextActionInput> = {}) => computeNextAction(base(over)).kind;

describe("computeNextAction (spec 1C — one next action)", () => {
  it("walks the prepaid shipping path: declare → assign → hand over → update", () => {
    expect(kind()).toBe("DECLARE_PAYMENT");
    expect(kind({ declaredPaymentStatus: "PAID" })).toBe("ASSIGN_SHIPPING");
    expect(
      kind({
        declaredPaymentStatus: "PAID",
        latestShipment: { status: null, hasCompany: true, labelReissueRequired: false },
      }),
    ).toBe("MARK_HANDED_OVER");
    expect(
      kind({
        declaredPaymentStatus: "PAID",
        latestShipment: { status: "LABEL_CREATED", hasCompany: true, labelReissueRequired: false },
      }),
    ).toBe("MARK_HANDED_OVER");
    expect(
      kind({
        declaredPaymentStatus: "PAID",
        latestShipment: { status: "SHIPPED", hasCompany: true, labelReissueRequired: false },
      }),
    ).toBe("UPDATE_SHIPMENT");
  });

  it("a declared-but-unconfirmed order is awaiting Finance for a user who cannot ship (no action)", () => {
    const action = computeNextAction(
      base({ declaredPaymentStatus: "PAID", can: { ...all, manageShipping: false } }),
    );
    expect(action).toMatchObject({ kind: "AWAITING_FINANCE", actionable: false });
    // Nothing left to declare and the gate still closed: also awaiting Finance.
    expect(kind({ canDeclareMore: false })).toBe("AWAITING_FINANCE");
  });

  it("COD ships before payment; payment is declared after delivery", () => {
    expect(kind({ paymentType: "CASH_ON_DELIVERY" })).toBe("ASSIGN_SHIPPING");
    expect(
      kind({
        paymentType: "CASH_ON_DELIVERY",
        fulfillmentCode: "DELIVERED",
        latestShipment: { status: "DELIVERED", hasCompany: true, labelReissueRequired: false },
      }),
    ).toBe("DECLARE_PAYMENT");
  });

  it("priorities: duplicate review, customer total, 0.00 amounts and label reissue come first", () => {
    expect(kind({ duplicateReviewPending: true, customerTotalConfirmationRequired: true })).toBe(
      "RESOLVE_DUPLICATE",
    );
    expect(kind({ customerTotalConfirmationRequired: true })).toBe("CONFIRM_CUSTOMER_TOTAL");
    expect(kind({ total: 0 })).toBe("SET_AMOUNTS");
    expect(kind({ total: 0, isAgentOrder: true })).toBe("DECLARE_PAYMENT");
    expect(
      kind({
        declaredPaymentStatus: "PAID",
        latestShipment: { status: "LABEL_CREATED", hasCompany: true, labelReissueRequired: true },
      }),
    ).toBe("REISSUE_LABEL");
    // Without the permission the step is skipped, not shown.
    expect(kind({ duplicateReviewPending: true, can: { ...all, reviewDuplicates: false } })).toBe(
      "DECLARE_PAYMENT",
    );
  });

  it("pickup: ready for pickup → collected", () => {
    const pickup = { fulfillmentMethod: "PICKUP" as const, declaredPaymentStatus: "PAID" as const };
    expect(kind({ ...pickup, fulfillmentCode: "AWAITING_PREPARATION" })).toBe(
      "MARK_READY_FOR_PICKUP",
    );
    expect(kind({ ...pickup, fulfillmentCode: "READY_FOR_PICKUP" })).toBe("MARK_COLLECTED");
  });

  it("after delivery: generate the invoice once fully paid; agent orders never get one", () => {
    const delivered = {
      fulfillmentCode: "DELIVERED",
      paymentStatus: "FULLY_PAID_RECONCILED",
      declaredPaymentStatus: "PAID" as const,
      canDeclareMore: false,
    };
    expect(kind(delivered)).toBe("GENERATE_INVOICE");
    expect(kind({ ...delivered, hasActiveInvoice: true })).toBe("NONE");
    expect(kind({ ...delivered, isAgentOrder: true })).toBe("NONE");
  });

  it("closed orders have no next action", () => {
    expect(kind({ archived: true })).toBe("NONE");
    expect(kind({ fulfillmentCode: "CANCELLED" })).toBe("NONE");
    expect(computeNextAction(base({ archived: true })).labelKey).toBeNull();
  });
});

describe("order header badges (payment vocabulary)", () => {
  it("payment: unpaid → declared → confirmed → settled", () => {
    expect(orderPaymentBadge({ paymentStatus: "PAYMENT_PENDING", paymentType: "PREPAID" })).toEqual(
      { labelKey: "storeOrders.paymentStatus.AWAITING_RECONCILIATION", tone: "neutral" },
    );
    expect(
      orderPaymentBadge({ paymentStatus: "PAYMENT_PENDING", declaredPaymentStatus: "PAID" }),
    ).toMatchObject({ labelKey: "paymentVocabulary.term.DECLARED.label" });
    expect(
      orderPaymentBadge({
        paymentStatus: "FULLY_PAID_RECONCILED",
        payments: [{ status: "VERIFIED", settlementStatus: "AWAITING_SETTLEMENT" }],
      }),
    ).toMatchObject({ labelKey: "paymentVocabulary.term.CONFIRMED.label", tone: "success" });
    expect(
      orderPaymentBadge({
        paymentStatus: "FULLY_PAID_RECONCILED",
        payments: [{ status: "VERIFIED", settlementStatus: "SETTLED" }],
      }),
    ).toMatchObject({ labelKey: "paymentVocabulary.term.SETTLED.label" });
    expect(orderPaymentBadge({ paymentStatus: "OVERPAID" })).toMatchObject({
      labelKey: "storeOrders.paymentStatus.OVERPAID",
    });
  });

  it("fulfillment: shipment status for shipping orders, catalog status otherwise", () => {
    expect(
      orderFulfillmentBadge({
        fulfillmentMethod: "SHIPPING",
        latestShipmentStatus: "SHIPPED",
        locale: "en",
      }).labelKey,
    ).toBe("shipping.status.SHIPPED");
    expect(
      orderFulfillmentBadge({
        fulfillmentMethod: "PICKUP",
        fulfillmentStatus: { code: "COLLECTED", name: "تم الاستلام", nameEn: "Collected" },
        latestShipmentStatus: null,
        locale: "en",
      }),
    ).toEqual({ labelKey: null, label: "Collected", tone: "success" });
  });
});
