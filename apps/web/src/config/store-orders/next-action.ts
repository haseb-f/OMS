import type { MessageKey } from "@/i18n/translate";

/**
 * Round 5 Spec 1C — the ONE next action of an order detail header, computed
 * from state and the caller's permissions (design-system §12.6: one primary
 * action chosen by workflow priority). Pure and unit-tested; the page maps
 * the kind to its handler.
 *
 * Priority: resolve duplicate review → confirm customer total → set agreed
 * amounts (0.00 order) → reissue a label an amendment invalidated → payment
 * gate (declare, or awaiting Finance) → fulfillment (assign shipping / mark
 * handed over / update shipment, or pickup ready / collected) → after
 * delivery: retry a failed recognition (R14 — the invoice is issued
 * automatically at delivery) → declare the collected payment.
 */
export type NextActionKind =
  | "RESOLVE_DUPLICATE"
  | "CONFIRM_CUSTOMER_TOTAL"
  | "SET_AMOUNTS"
  | "REISSUE_LABEL"
  | "DECLARE_PAYMENT"
  | "AWAITING_FINANCE"
  | "ASSIGN_SHIPPING"
  | "MARK_HANDED_OVER"
  | "UPDATE_SHIPMENT"
  | "MARK_READY_FOR_PICKUP"
  | "MARK_COLLECTED"
  | "GENERATE_INVOICE"
  | "NONE";

export interface NextActionInput {
  archived?: boolean;
  total: number;
  isAgentOrder: boolean;
  paymentType: "PREPAID" | "CASH_ON_DELIVERY";
  declaredPaymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID" | null | undefined;
  /** Finance-side `StoreOrder.paymentStatus`. */
  paymentStatus: string | null | undefined;
  fulfillmentMethod: "SHIPPING" | "PICKUP" | null | undefined;
  /** Fulfillment StatusDefinition code. */
  fulfillmentCode: string | null | undefined;
  /** Digital / service-only agent order — nothing ships. */
  digitalOnly?: boolean;
  latestShipment: {
    status: string | null;
    hasCompany: boolean;
    labelReissueRequired: boolean;
  } | null;
  duplicateReviewPending: boolean;
  customerTotalConfirmationRequired: boolean;
  hasActiveInvoice: boolean;
  /** Something is still declarable against the order total. */
  canDeclareMore: boolean;
  can: {
    reviewDuplicates: boolean;
    confirmCustomerTotal: boolean;
    setAmounts: boolean;
    declarePayment: boolean;
    manageShipping: boolean;
    recordPickup: boolean;
    generateInvoice: boolean;
  };
}

export interface NextAction {
  kind: NextActionKind;
  /** False for a status-only step (e.g. awaiting Finance) — shown, not clickable. */
  actionable: boolean;
  labelKey: MessageKey | null;
}

const LABEL: Record<Exclude<NextActionKind, "NONE">, MessageKey> = {
  RESOLVE_DUPLICATE: "orderAmendments.nextAction.RESOLVE_DUPLICATE",
  CONFIRM_CUSTOMER_TOTAL: "orderAmendments.nextAction.CONFIRM_CUSTOMER_TOTAL",
  SET_AMOUNTS: "orderAmendments.nextAction.SET_AMOUNTS",
  REISSUE_LABEL: "orderAmendments.nextAction.REISSUE_LABEL",
  DECLARE_PAYMENT: "orderAmendments.nextAction.DECLARE_PAYMENT",
  AWAITING_FINANCE: "orderAmendments.nextAction.AWAITING_FINANCE",
  ASSIGN_SHIPPING: "orderAmendments.nextAction.ASSIGN_SHIPPING",
  MARK_HANDED_OVER: "orderAmendments.nextAction.MARK_HANDED_OVER",
  UPDATE_SHIPMENT: "orderAmendments.nextAction.UPDATE_SHIPMENT",
  MARK_READY_FOR_PICKUP: "orderAmendments.nextAction.MARK_READY_FOR_PICKUP",
  MARK_COLLECTED: "orderAmendments.nextAction.MARK_COLLECTED",
  // R14 W3 — the invoice is issued automatically at delivery; the step only
  // remains when that recognition failed, so it reads as a retry.
  GENERATE_INVOICE: "storeOrderRecognition.retry",
};

const action = (kind: NextActionKind, actionable = true): NextAction => ({
  kind,
  actionable: kind !== "NONE" && actionable,
  labelKey: kind === "NONE" ? null : LABEL[kind],
});

const PAID_FINANCE = new Set(["FULLY_PAID_RECONCILED", "OVERPAID"]);
const CLOSED_FULFILLMENT = new Set(["CANCELLED", "RETURNED"]);
const DELIVERED_FULFILLMENT = new Set(["DELIVERED", "COLLECTED"]);

export function computeNextAction(input: NextActionInput): NextAction {
  const { can } = input;
  if (input.archived || CLOSED_FULFILLMENT.has(input.fulfillmentCode ?? "")) {
    return action("NONE");
  }
  if (input.duplicateReviewPending && can.reviewDuplicates) return action("RESOLVE_DUPLICATE");
  if (input.customerTotalConfirmationRequired && can.confirmCustomerTotal) {
    return action("CONFIRM_CUSTOMER_TOTAL");
  }
  if (input.total <= 0.005 && !input.hasActiveInvoice && !input.isAgentOrder && can.setAmounts) {
    return action("SET_AMOUNTS");
  }

  const financePaid = PAID_FINANCE.has(input.paymentStatus ?? "");
  const latest = input.latestShipment;
  const delivered =
    DELIVERED_FULFILLMENT.has(input.fulfillmentCode ?? "") || latest?.status === "DELIVERED";

  if (!delivered) {
    if (latest?.labelReissueRequired && can.manageShipping) return action("REISSUE_LABEL");
    const gateOpen =
      input.paymentType === "CASH_ON_DELIVERY" ||
      input.declaredPaymentStatus === "PAID" ||
      financePaid;
    if (!gateOpen) {
      if (input.canDeclareMore && can.declarePayment) return action("DECLARE_PAYMENT");
      return action("AWAITING_FINANCE", false);
    }
    if (input.digitalOnly) {
      return financePaid ? action("NONE") : action("AWAITING_FINANCE", false);
    }
    if (input.fulfillmentMethod === "PICKUP") {
      if (input.fulfillmentCode === "AWAITING_PREPARATION" && can.recordPickup) {
        return action("MARK_READY_FOR_PICKUP");
      }
      if (input.fulfillmentCode === "READY_FOR_PICKUP" && can.recordPickup) {
        return action("MARK_COLLECTED");
      }
    } else if (can.manageShipping) {
      if (!latest || !latest.hasCompany) return action("ASSIGN_SHIPPING");
      if (latest.status == null || latest.status === "LABEL_CREATED") {
        return action("MARK_HANDED_OVER");
      }
      return action("UPDATE_SHIPMENT");
    }
    // Nothing this user can move forward: a prepaid order declared but not
    // yet confirmed by Finance waits for their review.
    if (input.paymentType === "PREPAID" && !financePaid) {
      return action("AWAITING_FINANCE", false);
    }
    return action("NONE");
  }

  // R14 W3 — revenue, stock and COGS are recognised at delivery whatever the
  // payment status; a delivered company order without its invoice means that
  // recognition failed, so retrying it comes before collecting the payment.
  if (!input.isAgentOrder && !input.hasActiveInvoice && can.generateInvoice) {
    return action("GENERATE_INVOICE");
  }
  if (!financePaid && input.canDeclareMore && can.declarePayment) {
    return action("DECLARE_PAYMENT");
  }
  return action("NONE");
}
