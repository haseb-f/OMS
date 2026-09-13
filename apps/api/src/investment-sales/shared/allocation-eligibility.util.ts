import { Prisma } from '@prisma/client';

/**
 * Investor Engine Milestone 2, Phase 7 — the ONE centralized "is this a
 * qualifying sale" policy, never scattered status checks across services.
 *
 * A StoreOrder becomes investor-attributable once its Fulfillment status
 * reaches DELIVERED — the same milestone `sales-performance.service.ts`
 * already uses for "real, realized sale" reporting (`fulfillmentStatus: {
 * code: 'DELIVERED' }`), and the only StoreOrder milestone that won't
 * trivially reverse. Payment status is deliberately NOT part of this gate:
 * `sales-targets.service.ts`'s own COD-aware revenue reporting already
 * treats fulfillment and payment collection as separate concerns, and
 * requiring payment reconciliation too would silently exclude legitimate
 * COD sales that are delivered but still settling payment.
 *
 * Re-checked live (never cached) — a DELIVERED order can later flip to
 * CANCELLED/RETURNED, and `InvestmentSalesAllocationService`'s reconcile
 * pass re-evaluates this exact condition to detect that and reverse stale
 * allocations (Phase 11).
 */
export const ELIGIBLE_FULFILLMENT_CODE = 'DELIVERED';

/** Prisma `where` fragment for "StoreOrder is currently a qualifying sale." */
export function eligibleStoreOrderWhere(): Prisma.StoreOrderWhereInput {
  return {
    deletedAt: null,
    fulfillmentStatus: { code: ELIGIBLE_FULFILLMENT_CODE },
  };
}

/** Same condition, expressed for a StoreOrderItem query via its parent order. */
export function eligibleStoreOrderItemWhere(): Prisma.StoreOrderItemWhereInput {
  return {
    deletedAt: null,
    storeOrder: eligibleStoreOrderWhere(),
  };
}

export function isEligibleFulfillmentCode(
  code: string | null | undefined,
): boolean {
  return code === ELIGIBLE_FULFILLMENT_CODE;
}
