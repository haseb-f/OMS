import type { AgentReturnRow } from "@/services/agents-service";
import type { StoreOrderRow } from "@/services/store-orders-service";

/**
 * Agent-order helpers for the internal store-order screens
 * (specs/agents-fulfillment-partners §5, §6).
 */

const num = (value: string | number | null | undefined): number =>
  value == null || value === "" ? 0 : Number(value);

export interface AgentOrderBreakdown {
  mode: "SHIPPING_ADDED" | "SHIPPING_INCLUDED";
  merchandise: number;
  discount: number;
  tax: number;
  shipping: number;
  shippingSource: "NONE" | "RATE" | "MANUAL";
  /** Configured rate at entry — shown when a manual amount differs from it. */
  shippingRate: number | null;
  shippingOverrideReason: string | null;
  service: number;
  payable: number;
}

type BreakdownSource = Pick<
  StoreOrderRow,
  | "pricingMode"
  | "merchandiseAmount"
  | "discountAmount"
  | "taxAmount"
  | "shippingCharge"
  | "shippingChargeSource"
  | "shippingRateAmount"
  | "shippingOverrideReason"
  | "serviceCharge"
  | "payableTotal"
>;

/** The stored breakdown, or null for orders without a pricing mode (legacy / company orders). */
export function agentOrderBreakdown(order: BreakdownSource): AgentOrderBreakdown | null {
  if (!order.pricingMode) return null;
  const merchandise = num(order.merchandiseAmount);
  const tax = num(order.taxAmount);
  const shipping = num(order.shippingCharge);
  const service = num(order.serviceCharge);
  const payable =
    order.payableTotal != null && order.payableTotal !== ""
      ? num(order.payableTotal)
      : Math.round((merchandise + tax + shipping + service) * 100) / 100;
  return {
    mode: order.pricingMode,
    merchandise,
    discount: num(order.discountAmount),
    tax,
    shipping,
    shippingSource: order.shippingChargeSource ?? "NONE",
    shippingRate: order.shippingRateAmount != null ? num(order.shippingRateAmount) : null,
    shippingOverrideReason: order.shippingOverrideReason ?? null,
    service,
    payable,
  };
}

/** Quantity already received back per order line, across every recorded return. */
export function returnedQuantities(
  returns: Pick<AgentReturnRow, "lines">[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of returns) {
    for (const line of Array.isArray(row.lines) ? row.lines : []) {
      out[line.storeOrderItemId] = (out[line.storeOrderItemId] ?? 0) + Number(line.quantity);
    }
  }
  return out;
}

export type ReturnLineError = "notInteger" | "exceedsRemaining";

/**
 * Turns the dialog's per-line quantities into the API lines. Blank / 0 lines
 * are skipped; a quantity must be a whole number no larger than what is still
 * returnable on that line.
 */
export function buildReturnLines(
  items: { id: string; quantity: number }[],
  quantities: Record<string, string>,
  alreadyReturned: Record<string, number>,
): {
  lines: { storeOrderItemId: string; quantity: number }[];
  errors: Record<string, ReturnLineError>;
} {
  const lines: { storeOrderItemId: string; quantity: number }[] = [];
  const errors: Record<string, ReturnLineError> = {};
  for (const item of items) {
    const raw = (quantities[item.id] ?? "").trim();
    if (raw === "" || Number(raw) === 0) continue;
    const quantity = Number(raw);
    if (!Number.isInteger(quantity) || quantity < 0) {
      errors[item.id] = "notInteger";
      continue;
    }
    const remaining = Math.max(0, Number(item.quantity) - (alreadyReturned[item.id] ?? 0));
    if (quantity > remaining) {
      errors[item.id] = "exceedsRemaining";
      continue;
    }
    lines.push({ storeOrderItemId: item.id, quantity });
  }
  return { lines, errors };
}

/** A shipment that came back (API `RETURN_*` shipment status, or a carrier status naming a return). */
export function isReturnShipment(shipment: {
  status: string | null;
  shippingStatus?: { code: string } | null;
}): boolean {
  return (
    (shipment.status ?? "").startsWith("RETURN") ||
    (shipment.shippingStatus?.code ?? "").toUpperCase().includes("RETURN")
  );
}

/**
 * Shipments offered as "the returned parcel" on a return receipt: the ones
 * that came back; when none is marked returned yet, every shipment of the
 * order (the choice stays optional).
 */
export function returnShipmentChoices<
  T extends { status: string | null; shippingStatus?: { code: string } | null },
>(shipments: T[]): T[] {
  const returned = shipments.filter(isReturnShipment);
  return returned.length > 0 ? returned : shipments;
}

/**
 * Default of "charge the return fee" — mirrors the API rule (F-L4): a named
 * shipment is charged once (its first receipt; later receipts of the same
 * parcel are no-ops server-side); without a shipment only the order's first
 * return receipt charges.
 */
export function defaultChargeReturnFee(
  shipmentId: string | null,
  previousReturns: number,
): boolean {
  return shipmentId ? true : previousReturns === 0;
}
