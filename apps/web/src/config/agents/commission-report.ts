import { formatAmount } from "@/lib/money";
import type {
  CarrierCostStages,
  CommissionReportOrder,
  CurrencyAmount,
} from "@/services/agents-service";

/**
 * Actual carrier cost stage of an agent order (commission-policy.md A6) —
 * company expense only, never an agent deduction. Stages stay distinct:
 * estimate only → awaiting approval → approved.
 */
export type CarrierCostStage = "NONE" | "ESTIMATED" | "AWAITING_APPROVAL" | "APPROVED";

export function carrierCostStage(carrier: CarrierCostStages): CarrierCostStage {
  if (carrier.incurredByCurrency.length > 0) return "AWAITING_APPROVAL";
  if (carrier.approvedByCurrency.length > 0) return "APPROVED";
  if (carrier.estimated > 0) return "ESTIMATED";
  return "NONE";
}

/**
 * How the order's shipping settled (A6 + owner decision O1): the customer
 * shipping the company retained covers the predetermined agent charge as if
 * it equalled the charge — a shortfall is borne by the company, an excess is
 * kept by the company (internal report only; the portal carries no
 * difference, so the agent always sees "settled"). Orders without an agent
 * charge only retain what was collected (legacy / other policies).
 */
export type ShippingSettlement =
  "SETTLED" | "COMPANY_BEARS_SHORTFALL" | "COMPANY_KEEPS_EXCESS" | "NO_AGENT_CHARGE";

export function shippingSettlement(
  shipping: Pick<CommissionReportOrder["shipping"], "agentShippingCharge" | "difference">,
): ShippingSettlement {
  if (shipping.agentShippingCharge == null) return "NO_AGENT_CHARGE";
  const difference = shipping.difference ?? 0;
  if (difference <= -0.005) return "COMPANY_BEARS_SHORTFALL";
  if (difference >= 0.005) return "COMPANY_KEEPS_EXCESS";
  return "SETTLED";
}

/** "SAR 10,000.00 · EGP 1,300.00" — amounts per carrier currency, never summed across currencies. */
export function formatCurrencyAmounts(amounts: CurrencyAmount[]): string {
  if (amounts.length === 0) return "—";
  return amounts.map((a) => `${a.currencyCode} ${formatAmount(a.amount)}`).join(" · ");
}
