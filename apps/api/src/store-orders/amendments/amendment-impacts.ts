import type { ShipmentStatus } from '@prisma/client';

/**
 * Round 5 Spec 1A — the vocabulary of an order amendment preview. Pure (no
 * I/O) so the window rules and the acknowledgement gate are unit-testable and
 * the preview and the commit share one decision.
 *
 *  - BLOCKING: the commit is refused; the message names the prior step.
 *  - ACKNOWLEDGE: the commit needs the code echoed in `acknowledgements`.
 *  - INFO: shown in the preview; no acknowledgement needed.
 */
export type AmendmentSeverity = 'BLOCKING' | 'ACKNOWLEDGE' | 'INFO';

export const AMENDMENT_IMPACT_SEVERITY = {
  // ── Editable window ──
  ORDER_LOCKED_AFTER_DELIVERY: 'BLOCKING',
  ORDER_IN_TRANSIT: 'BLOCKING',
  LABEL_REISSUE_REQUIRED: 'ACKNOWLEDGE',
  // ── Totals / payments ──
  TOTALS_CHANGED: 'INFO',
  ORDER_TOTAL_ZERO: 'BLOCKING',
  DECLARATION_REEVALUATED: 'ACKNOWLEDGE',
  PAYMENT_STATUS_REEVALUATED: 'INFO',
  PAYMENT_OVERPAID_REFUND: 'ACKNOWLEDGE',
  CURRENCY_LOCKED_BY_PAYMENT: 'BLOCKING',
  CURRENCY_DECLARATIONS_REVIEW: 'ACKNOWLEDGE',
  // ── Invoice ──
  INVOICE_DRAFT_CANCELLED: 'ACKNOWLEDGE',
  INVOICE_POSTED: 'BLOCKING',
  // ── Customer ──
  CUSTOMER_PERMISSION_REQUIRED: 'BLOCKING',
  CUSTOMER_OUT_OF_SCOPE: 'BLOCKING',
  CUSTOMER_PHONE_IN_USE: 'BLOCKING',
  CUSTOMER_MASTER_SHARED: 'ACKNOWLEDGE',
  CUSTOMER_DUPLICATE_REVIEW: 'ACKNOWLEDGE',
  CUSTOMER_RELINKED: 'INFO',
  // ── Lines ──
  LINE_HAS_ALLOCATIONS: 'BLOCKING',
  // ── Agent orders ──
  AGENT_COMMISSION_EARNED: 'BLOCKING',
  AGENT_STOCK_ISSUED: 'BLOCKING',
  AGENT_FINANCIAL_RECORDS: 'BLOCKING',
  AGENT_PRICING_INVALID: 'BLOCKING',
  AGENT_SHIPPING_TARIFF_MISSING: 'BLOCKING',
  AGENT_REQUOTED: 'INFO',
  AGENT_SHIPPING_REPRICED: 'INFO',
  AGENT_SHIPPING_OVERRIDE_DROPPED: 'INFO',
} as const satisfies Record<string, AmendmentSeverity>;

export type AmendmentImpactCode = keyof typeof AMENDMENT_IMPACT_SEVERITY;

export interface AmendmentImpact {
  code: AmendmentImpactCode;
  severity: AmendmentSeverity;
  /** English fallback; the web renders the localized text from `code` + `params`. */
  message: string;
  params: Record<string, string | number | null>;
}

export function amendmentImpact(
  code: AmendmentImpactCode,
  message: string,
  params: AmendmentImpact['params'] = {},
): AmendmentImpact {
  return { code, severity: AMENDMENT_IMPACT_SEVERITY[code], message, params };
}

/** Pickup / order fulfillment codes after which nothing can be amended. */
const LOCKED_FULFILLMENT_CODES = new Set([
  'DELIVERED',
  'COLLECTED',
  'RETURNED',
  'CANCELLED',
]);
const LOCKED_SHIPMENT_STATUSES = new Set<ShipmentStatus>([
  'DELIVERED',
  'RETURN_BEFORE_DELIVERY',
  'RETURN_AFTER_DELIVERY',
]);
const IN_TRANSIT_SHIPMENT_STATUSES = new Set<ShipmentStatus>([
  'SHIPPED',
  'OUT_FOR_DELIVERY',
]);

export type AmendmentWindow = 'OPEN' | 'IN_TRANSIT' | 'LOCKED';

/**
 * Spec 1A editable window: open with no shipment or a latest shipment that
 * has not left (LABEL_CREATED / NEEDS_RESHIPMENT / DELIVERY_FAILED); in
 * transit while SHIPPED / OUT_FOR_DELIVERY; locked once delivered, returned,
 * collected, cancelled or archived.
 */
export function amendmentWindow(input: {
  archived: boolean;
  fulfillmentCode: string | null | undefined;
  latestShipmentStatus: ShipmentStatus | null | undefined;
}): AmendmentWindow {
  if (
    input.archived ||
    (input.fulfillmentCode &&
      LOCKED_FULFILLMENT_CODES.has(input.fulfillmentCode)) ||
    (input.latestShipmentStatus &&
      LOCKED_SHIPMENT_STATUSES.has(input.latestShipmentStatus))
  ) {
    return 'LOCKED';
  }
  if (
    input.latestShipmentStatus &&
    IN_TRANSIT_SHIPMENT_STATUSES.has(input.latestShipmentStatus)
  ) {
    return 'IN_TRANSIT';
  }
  return 'OPEN';
}

/** Which kinds of change an amendment carries (drives the window rules). */
export interface AmendmentChangeKinds {
  /** Lines added / removed / product or quantity changed. */
  items: boolean;
  /** Only agreed amounts of existing lines changed. */
  amounts: boolean;
  currency: boolean;
  paymentType: boolean;
  fulfillmentMethod: boolean;
  destination: boolean;
  customerSwitch: boolean;
  customerCorrection: boolean;
  pricing: boolean;
}

/** Items, address and fulfillment method: what a label / a shipped parcel carries. */
export function touchesShippedContents(kinds: AmendmentChangeKinds): boolean {
  return kinds.items || kinds.destination || kinds.fulfillmentMethod;
}

/** Changes that alter the invoiced document (lines, amounts, currency, customer). */
export function touchesInvoice(kinds: AmendmentChangeKinds): boolean {
  return (
    kinds.items ||
    kinds.amounts ||
    kinds.currency ||
    kinds.pricing ||
    kinds.customerSwitch
  );
}

export function hasAnyChange(kinds: AmendmentChangeKinds): boolean {
  return Object.values(kinds).some(Boolean);
}

export function blockingImpacts(impacts: AmendmentImpact[]) {
  return impacts.filter((i) => i.severity === 'BLOCKING');
}

/** ACKNOWLEDGE codes not echoed back by the caller. */
export function missingAcknowledgements(
  impacts: AmendmentImpact[],
  acknowledgements: readonly string[] | undefined,
): AmendmentImpactCode[] {
  const given = new Set(acknowledgements ?? []);
  return [
    ...new Set(
      impacts
        .filter((i) => i.severity === 'ACKNOWLEDGE' && !given.has(i.code))
        .map((i) => i.code),
    ),
  ];
}

/** Two-decimal money text for impact messages. */
export const money = (value: number) =>
  (Math.round(value * 100) / 100).toFixed(2);

/**
 * An investment allocation pins a sold line. ACTIVE allocations and open
 * reallocations (PENDING / APPROVED) block any change of product, quantity
 * or agreed amount; removing the line is blocked while ANY allocation row
 * (even a reversed one — it stays as history) references it.
 */
export function lineAllocationBlocked(input: {
  removed: boolean;
  changed: boolean;
  allocationStatuses: string[];
  reallocationStatuses: string[];
}): boolean {
  if (input.removed) {
    return (
      input.allocationStatuses.length > 0 ||
      input.reallocationStatuses.length > 0
    );
  }
  if (!input.changed) return false;
  return (
    input.allocationStatuses.some((status) => status !== 'REVERSED') ||
    input.reallocationStatuses.some(
      (status) => status === 'PENDING' || status === 'APPROVED',
    )
  );
}
