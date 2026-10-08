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

const PREPAID_BASIS_MISSING =
  'The prepaid payment is not declared paid in full or verified by Finance yet (a partial declaration is not enough). Shipping does not wait for it.';

/**
 * The prepaid payment basis of an order (payment-declaration-reconciliation
 * §2): Sales declared it PAID in full OR Finance verified it paid;
 * PARTIALLY_PAID never satisfies it; COD always does. R15 (D15-3): this is
 * information only — the package slip says whether a prepaid parcel is paid —
 * and never gates the physical flow: reservation, the Shipping queue,
 * dispatch, pickup, delivery and returns ignore payment status.
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
    reason: PREPAID_BASIS_MISSING,
  };
}
