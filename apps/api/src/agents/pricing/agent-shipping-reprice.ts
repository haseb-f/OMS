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
 */
export interface RepriceInput {
  mode: AgentPricingMode;
  merchandiseAmount: number;
  taxAmount: number;
  serviceCharge: number;
  shippingCharge: number;
  payableTotal: number;
  lines: Array<{ id: string; quantity: number; amount: number }>;
  fee: number;
}

export type RepriceResult =
  | {
      kind: 'APPLY';
      shippingCharge: number;
      merchandiseAmount: number;
      payableTotal: number;
      /** Only when the merchandise was re-allocated (SHIPPING_INCLUDED). */
      lines: Array<{ id: string; amount: number; unitPrice: number }> | null;
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
    const weights = input.lines.map((l) => toMinor(l.amount));
    const allocated = allocateMinor(
      merchandise,
      weights.every((w) => w > 0)
        ? weights
        : input.lines.map((l) => l.quantity),
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
  };
}
