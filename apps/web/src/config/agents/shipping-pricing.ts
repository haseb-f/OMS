import type { ShippingPricingView } from "@/services/agents-service";

/**
 * How an agent order's shipping pricing is presented (spec-2-agent-pricing.md
 * 2B): a provisional fee is always labelled; a shipping-added total is shown
 * as "merchandise + shipping (pending)" — never as final — until Shipping
 * selects the delivery method; a higher confirmed total needs the
 * customer's agreement; paid vs payable shows what is still outstanding.
 */
export interface ShippingPricingDisplay {
  provisional: boolean;
  /** Shipping added + provisional: the payable total is not final. */
  payablePending: boolean;
  confirmationRequired: boolean;
  /** Paid something and a difference remains (e.g. paid 425, new payable 435 → 10). */
  showOutstanding: boolean;
}

export function shippingPricingDisplay(
  view: Pick<
    ShippingPricingView,
    "status" | "pricingMode" | "customerTotalStatus" | "paidAmount" | "outstanding"
  > | null,
): ShippingPricingDisplay {
  if (!view) {
    return {
      provisional: false,
      payablePending: false,
      confirmationRequired: false,
      showOutstanding: false,
    };
  }
  const provisional = view.status === "PENDING_METHOD";
  return {
    provisional,
    payablePending: provisional && view.pricingMode !== "SHIPPING_INCLUDED",
    confirmationRequired: view.customerTotalStatus === "CONFIRMATION_REQUIRED",
    showOutstanding: view.paidAmount > 0 && (view.outstanding ?? 0) > 0,
  };
}
