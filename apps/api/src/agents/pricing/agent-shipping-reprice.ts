import { allocateMinor, type AgentPricingMode } from './agent-order-pricing';

/**
 * Customer-side effect of a confirmed contractual shipping fee
 * (spec-2-agent-pricing.md 2B, "Shipping-inclusive" / "Shipping-added").
 * Pure: integer minor units, deterministic.
 *
 *  - SHIPPING_INCLUDED: the agreed customer total never changes; customer
 *    shipping = fee, merchandise = total − service − tax − fee, re-allocated
 *    over the lines by their current amounts (the existing allocation). A fee
 *    that leaves no merchandise room is refused with both amounts.
 *  - SHIPPING_ADDED: merchandise unchanged; customer shipping = fee. A higher
 *    payable than the provisional one needs the customer's agreement (never
 *    silently re-billed); an equal or lower payable is applied at once.
 *  - A MANUAL customer shipping charge (authorized override) is the price the
 *    customer agreed to: the confirmed fee changes only the agent side, so the
 *    customer amounts stay exactly as they are (owner decision O1 — the
 *    company bears / keeps the difference).
 */
export interface RepriceInput {
  mode: AgentPricingMode;
  merchandiseAmount: number;
  taxAmount: number;
  serviceCharge: number;
  shippingCharge: number;
  payableTotal: number;
  /** `listAmount` = list price × quantity at submission (null = none). */
  lines: Array<{
    id: string;
    quantity: number;
    amount: number;
    listAmount?: number | null;
  }>;
  fee: number;
  /** The customer shipping charge was set by an authorized manual override. */
  manualShippingCharge?: boolean;
}

export type RepriceResult =
  | {
      kind: 'APPLY';
      shippingCharge: number;
      merchandiseAmount: number;
      payableTotal: number;
      /** Only when the merchandise was re-allocated (SHIPPING_INCLUDED). */
      lines: Array<{ id: string; amount: number; unitPrice: number }> | null;
      /**
       * Re-allocated only: Σ max(0, list − line amount) — the same
       * informational discount the order entry computes (lines without a
       * list price contribute 0). Null = unchanged.
       */
      discountAmount: number | null;
    }
  | {
      kind: 'CONFIRMATION_REQUIRED';
      proposedShippingCharge: number;
      proposedPayableTotal: number;
    }
  | {
      kind: 'REFUSED';
      code: 'AGENT_SHIPPING_EXCEEDS_TOTAL';
      agreedTotal: number;
      fee: number;
    };

const toMinor = (value: number) => Math.round(value * 100);
const fromMinor = (minor: number) => minor / 100;

export function repriceForConfirmedFee(input: RepriceInput): RepriceResult {
  if (input.manualShippingCharge) {
    return {
      kind: 'APPLY',
      shippingCharge: input.shippingCharge,
      merchandiseAmount: input.merchandiseAmount,
      payableTotal: input.payableTotal,
      lines: null,
      discountAmount: null,
    };
  }
  const fee = toMinor(input.fee);
  const tax = toMinor(input.taxAmount);
  const service = toMinor(input.serviceCharge);
  const payable = toMinor(input.payableTotal);
  if (input.mode === 'SHIPPING_INCLUDED') {
    const merchandise = payable - service - tax - fee;
    if (merchandise <= 0) {
      return {
        kind: 'REFUSED',
        code: 'AGENT_SHIPPING_EXCEEDS_TOTAL',
        agreedTotal: fromMinor(payable),
        fee: fromMinor(fee),
      };
    }
    // The existing allocation is the weight: a 0 line stays 0. Quantities
    // only when there is no allocation at all.
    const weights = input.lines.map((l) => toMinor(l.amount));
    const allocated = allocateMinor(
      merchandise,
      weights.reduce((a, b) => a + b, 0) > 0
        ? weights
        : input.lines.map((l) => l.quantity),
    );
    const discount = input.lines.reduce(
      (sum, line, index) =>
        line.listAmount == null
          ? sum
          : sum + Math.max(0, toMinor(line.listAmount) - allocated[index]),
      0,
    );
    return {
      kind: 'APPLY',
      shippingCharge: fromMinor(fee),
      merchandiseAmount: fromMinor(merchandise),
      payableTotal: fromMinor(payable),
      lines: input.lines.map((line, index) => ({
        id: line.id,
        amount: fromMinor(allocated[index]),
        unitPrice: fromMinor(Math.round(allocated[index] / line.quantity)),
      })),
      discountAmount: fromMinor(discount),
    };
  }
  const merchandise = toMinor(input.merchandiseAmount);
  const nextPayable = merchandise + tax + service + fee;
  if (nextPayable > payable) {
    return {
      kind: 'CONFIRMATION_REQUIRED',
      proposedShippingCharge: fromMinor(fee),
      proposedPayableTotal: fromMinor(nextPayable),
    };
  }
  return {
    kind: 'APPLY',
    shippingCharge: fromMinor(fee),
    merchandiseAmount: fromMinor(merchandise),
    payableTotal: fromMinor(nextPayable),
    lines: null,
    discountAmount: null,
  };
}
