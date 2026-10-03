import { storeOrderFulfillmentCode } from "@/components/store-orders/store-order-workflow-tracks";
import { computeNextAction, type NextAction, type NextActionInput } from "./next-action";
import type { StoreOrderRow } from "@/services/store-orders-service";
import type { PortalOrderRow } from "@/services/agent-portal-service";

/**
 * The next step of an order as a LIST row shows it - the same rules as the
 * order detail header (`computeNextAction`, one source of truth), fed with
 * what a list row carries. Facts a list row does not load (the payment
 * ledger's remaining amount) fall back to the declared status, which is only
 * ever less specific, never contradicting the detail page's primary action.
 */
export interface CompanyOrderPermissions {
  reviewDuplicates: boolean;
  confirmCustomerTotal: boolean;
  setAmounts: boolean;
  declarePayment: boolean;
  manageShipping: boolean;
  recordPickup: boolean;
  generateInvoice: boolean;
}

export function companyOrderNextAction(
  order: StoreOrderRow,
  can: CompanyOrderPermissions,
): NextAction {
  const latest = order.shipments?.[0] ?? null;
  const input: NextActionInput = {
    total: Number(order.total ?? 0),
    isAgentOrder: Boolean(order.agentId),
    paymentType: order.paymentType,
    declaredPaymentStatus: order.declaredPaymentStatus,
    paymentStatus: order.paymentStatus,
    fulfillmentMethod: order.fulfillmentMethod,
    fulfillmentCode: storeOrderFulfillmentCode(order),
    latestShipment: latest
      ? {
          status: latest.status,
          hasCompany: Boolean(latest.shippingCompanyId ?? latest.shippingCompany),
          labelReissueRequired: latest.labelReissueRequired === true,
        }
      : null,
    duplicateReviewPending: order.duplicateReviewStatus === "PENDING",
    customerTotalConfirmationRequired: order.customerTotalStatus === "CONFIRMATION_REQUIRED",
    hasActiveInvoice: Boolean(order.invoices?.some((invoice) => invoice.status !== "CANCELLED")),
    canDeclareMore: order.declaredPaymentStatus !== "PAID",
    can,
  };
  return computeNextAction(input);
}

/** The agent portal's order row - the agent can declare payments, nothing else here. */
export function portalOrderNextAction(
  order: PortalOrderRow,
  can: { declarePayment: boolean },
): NextAction {
  return computeNextAction({
    total: order.breakdown.payableTotal,
    isAgentOrder: true,
    paymentType: order.paymentType,
    declaredPaymentStatus: order.declaredPaymentStatus,
    paymentStatus: order.financePaymentStatus,
    fulfillmentMethod: order.fulfillmentMethod,
    fulfillmentCode: order.fulfillmentStatus?.code ?? null,
    latestShipment: null,
    duplicateReviewPending: false,
    customerTotalConfirmationRequired: false,
    hasActiveInvoice: false,
    canDeclareMore: order.declaredPaymentStatus !== "PAID",
    can: {
      reviewDuplicates: false,
      confirmCustomerTotal: false,
      setAmounts: false,
      declarePayment: can.declarePayment,
      manageShipping: false,
      recordPickup: false,
      generateInvoice: false,
    },
  });
}
