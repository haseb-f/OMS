import {
  StoreOrderDeclaredPaymentStatus,
  StoreOrderPaymentStatus,
  StoreOrderPaymentType,
} from '@prisma/client';
import { PAID_PAYMENT_CODES } from '../workflow/workflow-status-map';

export type FulfillmentGateBasis = 'COD' | 'DECLARED_PAID' | 'VERIFIED_PAID';

export interface FulfillmentGateResult {
  allowed: boolean;
  settlementMode: 'COD' | 'PREPAID';
  basis: FulfillmentGateBasis | null;
  reason: string | null;
}

export const PREPAID_GATE_REASON =
  'Prepaid orders need the customer payment declared as paid in full (or verified by Finance) before shipment or collection. A partial declaration is not enough.';

/**
 * The single prepaid fulfillment rule (payment-declaration-reconciliation §2):
 * a PREPAID order may ship / be collected once Sales declared it PAID in full
 * OR Finance verified it paid. PARTIALLY_PAID never satisfies it. COD is
 * unchanged. This only permits — it never advances any fulfillment state.
 */
export function evaluateFulfillmentGate(order: {
  paymentType: StoreOrderPaymentType | null;
  declaredPaymentStatus: StoreOrderDeclaredPaymentStatus | null;
  paymentStatus: StoreOrderPaymentStatus | null;
  paymentStatusCode?: string | null;
}): FulfillmentGateResult {
  if (order.paymentType === StoreOrderPaymentType.CASH_ON_DELIVERY) {
    return { allowed: true, settlementMode: 'COD', basis: 'COD', reason: null };
  }
  const verifiedPaid =
    order.paymentStatus === StoreOrderPaymentStatus.FULLY_PAID_RECONCILED ||
    order.paymentStatus === StoreOrderPaymentStatus.OVERPAID ||
    (order.paymentStatusCode != null &&
      PAID_PAYMENT_CODES.has(order.paymentStatusCode));
  if (verifiedPaid) {
    return {
      allowed: true,
      settlementMode: 'PREPAID',
      basis: 'VERIFIED_PAID',
      reason: null,
    };
  }
  if (order.declaredPaymentStatus === StoreOrderDeclaredPaymentStatus.PAID) {
    return {
      allowed: true,
      settlementMode: 'PREPAID',
      basis: 'DECLARED_PAID',
      reason: null,
    };
  }
  return {
    allowed: false,
    settlementMode: 'PREPAID',
    basis: null,
    reason: PREPAID_GATE_REASON,
  };
}
