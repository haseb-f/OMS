import type { AgentAgreement } from '@prisma/client';

/**
 * Terms an agent order was submitted under (spec §2 "Snapshot"). Written once
 * by the order service into `StoreOrder.agentTermsSnapshot`; read by the
 * finance hooks. Agreement edits never change it.
 */
export interface AgentTermsSnapshot {
  agreementId: string;
  agreementNumber: string;
  currencyId: string;
  commissionRatePercent: number;
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
}

/** What `StoreOrder.agentTermsSnapshot` holds: agreement terms + order facts. */
export interface AgentOrderSnapshot extends AgentTermsSnapshot {
  customer?: AgentCustomerSnapshot;
  lines?: AgentLineSnapshot[];
}

export function snapshotAgreementTerms(
  agreement: AgentAgreement,
): AgentTermsSnapshot {
  return {
    agreementId: agreement.id,
    agreementNumber: agreement.agreementNumber,
    currencyId: agreement.currencyId,
    commissionRatePercent: Number(agreement.commissionRatePercent),
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
