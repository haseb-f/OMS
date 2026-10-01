import type { AgentAgreement } from '@prisma/client';
import type { AgentLineCommissionRate } from '../commission/agent-commission';

/**
 * Terms an agent order was submitted under (spec §2 "Snapshot"). Written once
 * by the order service into `StoreOrder.agentTermsSnapshot`; read by the
 * finance hooks. Agreement edits never change it.
 */
export interface AgentTermsSnapshot {
  agreementId: string;
  agreementNumber: string;
  currencyId: string;
  /** commission-policy.md A3 — per-class defaults. Absent on legacy snapshots. */
  productCommissionRatePercent?: number;
  serviceCommissionRatePercent?: number;
  shippingPolicy?: 'PREDETERMINED_CHARGE' | 'FLAT_FEE_PER_SHIPMENT' | 'NONE';
  /** Legacy single rate (orders submitted before commission-policy.md). */
  commissionRatePercent?: number;
  commissionEarningEvent: 'DELIVERED' | 'PAYMENT_VERIFIED';
  returnCommissionTreatment: 'REVERSE' | 'RETAIN';
  customerShippingChargeOwner: 'COMPANY' | 'AGENT';
  providerFeesBorneBy: 'COMPANY' | 'AGENT';
  shippingFeePerShipment: number;
  returnFeePerShipment: number;
  serviceFeePerOrder: number;
  allowAgentDestinations: boolean;
  payoutHoldDays: number;
}

/**
 * The customer exactly as typed on the agent order (spec §2 snapshot, S1):
 * the portal shows only this — never another party's stored master data —
 * and agent flows never write it back onto a shared Partner.
 */
export interface AgentCustomerSnapshot {
  name: string;
  mobile: string | null;
  countryId: string | null;
  city: string | null;
  address: string | null;
}

/**
 * Per-line fulfillment facts frozen at submission (F-L7): whether the line
 * moves stock. Dispatch / digital-only decisions read this, not the live
 * product flag (which may change after the order).
 */
export interface AgentLineSnapshot {
  productId: string;
  inventoryLine: boolean;
  /** commission-policy.md A5 — resolved at submission; absent on legacy snapshots. */
  commission?: AgentLineCommissionRate;
  /**
   * Spec 2 — list price × quantity at submission (null = no list price), so a
   * re-allocated shipping-included line keeps its informational discount
   * (max(0, list − line amount)) consistent.
   */
  listAmount?: number | null;
}

/** What `StoreOrder.agentTermsSnapshot` holds: agreement terms + order facts. */
/**
 * commission-policy.md A3/A5 — the agent shipping charge fixed at submission
 * (PREDETERMINED_CHARGE policy): the agreement rate for the order's shipping
 * type/destination, 0 for pickup and digital-only orders.
 */
export interface AgentShippingChargeSnapshot {
  amount: number;
  /**
   * RATE = resolved at submission; TARIFF = resolved when Shipping chose the
   * delivery method (spec-2-agent-pricing.md 2B); PICKUP / DIGITAL_ONLY = 0.
   */
  source: 'RATE' | 'TARIFF' | 'PICKUP' | 'DIGITAL_ONLY';
  rateId: string | null;
  /** Spec 2 — true while the delivery method is unknown (estimate only). */
  provisional?: boolean;
  /** Channel the amount was resolved for (null = same fee for every channel). */
  deliveryChannel?: 'CARRIER' | 'INTERNAL_COURIER' | null;
  paymentType?: 'PREPAID' | 'CASH_ON_DELIVERY';
  /** Destination the tariff is resolved for (re-resolution uses it). */
  countryId?: string | null;
  city?: string | null;
  shippingCompanyId?: string | null;
  resolvedAt?: string;
  resolvedBy?: string | null;
  /**
   * Spec 2 — the tariff of every delivery channel as resolved at submission
   * (null = not configured). Shipping's later choice is priced from this
   * frozen copy: agreement edits never change an existing order. Absent on
   * legacy snapshots, which are never re-resolved.
   */
  byChannel?: Record<
    'CARRIER' | 'INTERNAL_COURIER',
    { rateId: string; amount: number } | null
  >;
}

/**
 * Spec 2 — a shipping-added order whose confirmed payable rose above the
 * provisional one: the customer must agree before it is billed.
 */
export interface AgentCustomerTotalChange {
  previousShippingCharge: number;
  previousPayableTotal: number;
  proposedShippingCharge: number;
  proposedPayableTotal: number;
  requestedAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
}

export interface AgentOrderSnapshot extends AgentTermsSnapshot {
  customer?: AgentCustomerSnapshot;
  lines?: AgentLineSnapshot[];
  agentShippingCharge?: AgentShippingChargeSnapshot | null;
  customerTotalChange?: AgentCustomerTotalChange | null;
}

export function snapshotAgreementTerms(
  agreement: AgentAgreement,
): AgentTermsSnapshot {
  return {
    agreementId: agreement.id,
    agreementNumber: agreement.agreementNumber,
    currencyId: agreement.currencyId,
    productCommissionRatePercent: Number(
      agreement.productCommissionRatePercent,
    ),
    serviceCommissionRatePercent: Number(
      agreement.serviceCommissionRatePercent,
    ),
    shippingPolicy: agreement.shippingPolicy,
    commissionEarningEvent: agreement.commissionEarningEvent,
    returnCommissionTreatment: agreement.returnCommissionTreatment,
    customerShippingChargeOwner: agreement.customerShippingChargeOwner,
    providerFeesBorneBy: agreement.providerFeesBorneBy,
    shippingFeePerShipment: Number(agreement.shippingFeePerShipment),
    returnFeePerShipment: Number(agreement.returnFeePerShipment),
    serviceFeePerOrder: Number(agreement.serviceFeePerOrder),
    allowAgentDestinations: agreement.allowAgentDestinations,
    payoutHoldDays: agreement.payoutHoldDays,
  };
}

/**
 * The shipping reimbursement policy an order was submitted under. Legacy
 * snapshots (before the policy existed) charged the flat per-shipment fee.
 */
export function shippingPolicyOf(
  terms: AgentTermsSnapshot,
): NonNullable<AgentTermsSnapshot['shippingPolicy']> {
  return terms.shippingPolicy ?? 'FLAT_FEE_PER_SHIPMENT';
}

export function readAgentTermsSnapshot(value: unknown): AgentOrderSnapshot {
  if (!value || typeof value !== 'object' || !('agreementId' in value)) {
    throw new Error('Agent order has no agreement terms snapshot.');
  }
  return value as AgentOrderSnapshot;
}

/** The typed customer of an agent order, or null for orders created before the snapshot existed. */
export function readAgentCustomerSnapshot(
  value: unknown,
): AgentCustomerSnapshot | null {
  if (!value || typeof value !== 'object' || !('customer' in value)) {
    return null;
  }
  const customer = (value as AgentOrderSnapshot).customer;
  return customer && typeof customer.name === 'string' ? customer : null;
}

/**
 * Whether an agent order has no inventory line (digital/service only — no
 * shipment, no dispatch). Reads the per-line stock flag frozen in the order
 * snapshot (F-L7), falling back to the live product flag for lines the
 * snapshot does not cover (orders created before it carried lines).
 */
export function isAgentOrderDigitalOnly(order: {
  agentTermsSnapshot: unknown;
  items: { productId: string; product: { isInventoryItem: boolean } }[];
}): boolean {
  const snapshot = order.agentTermsSnapshot;
  const lines =
    snapshot && typeof snapshot === 'object' && 'lines' in snapshot
      ? (snapshot as AgentOrderSnapshot).lines
      : undefined;
  return !order.items.some((item) => {
    const frozen = lines?.find((line) => line.productId === item.productId);
    return frozen ? frozen.inventoryLine : item.product.isInventoryItem;
  });
}

export interface AgentFulfillmentOrderFacts {
  agentDispatchedAt: Date | null;
  agentEarnedAt: Date | null;
  fulfillmentStatus: { code: string } | null;
  digitalOnly: boolean;
  returnCount: number;
}

/**
 * Dashboard fulfillment buckets (internal workspace + portal). Physical
 * orders: awaiting dispatch until dispatched, dispatched until earned,
 * completed once earned. Digital-only orders never wait for shipment — they
 * are completed once earned (verified/earned) and otherwise in no shipping
 * bucket.
 */
export function aggregateAgentFulfillment(
  orders: AgentFulfillmentOrderFacts[],
) {
  const active = orders.filter(
    (o) => o.fulfillmentStatus?.code !== 'CANCELLED',
  );
  return {
    total: orders.length,
    awaitingDispatch: active.filter(
      (o) => !o.digitalOnly && !o.agentDispatchedAt,
    ).length,
    dispatched: active.filter(
      (o) => !o.digitalOnly && o.agentDispatchedAt && !o.agentEarnedAt,
    ).length,
    completed: active.filter((o) => o.agentEarnedAt).length,
    withReturns: active.filter((o) => o.returnCount > 0).length,
    cancelled: orders.length - active.length,
  };
}

/** Dashboard facts of one order row (selected with snapshot + items' product flag + return count). */
export function agentFulfillmentFacts(order: {
  agentDispatchedAt: Date | null;
  agentEarnedAt: Date | null;
  agentTermsSnapshot: unknown;
  fulfillmentStatus: { code: string } | null;
  items: { productId: string; product: { isInventoryItem: boolean } }[];
  _count: { agentReturns: number };
}): AgentFulfillmentOrderFacts {
  return {
    agentDispatchedAt: order.agentDispatchedAt,
    agentEarnedAt: order.agentEarnedAt,
    fulfillmentStatus: order.fulfillmentStatus,
    digitalOnly: isAgentOrderDigitalOnly(order),
    returnCount: order._count.agentReturns,
  };
}
