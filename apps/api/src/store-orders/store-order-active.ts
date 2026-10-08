/** Fulfillment status code (workflow catalog) of a cancelled store order — e.g. a pickup cancelled without archiving. */
export const STORE_ORDER_CANCELLED_CODE = 'CANCELLED';

/**
 * R15 (review M2) — the ONE "is this order still active?" rule. An order is
 * cancelled when it is archived or its fulfillment is CANCELLED. The stock
 * lifecycle (releases / receives back a cancelled order's goods) and the money
 * position (a cancelled order owes only what was delivered and kept, so its
 * advance becomes refundable) must agree on it.
 */
export function isStoreOrderActive(order: {
  deletedAt: Date | null;
  fulfillmentStatus?: { code: string } | null;
}): boolean {
  return (
    order.deletedAt === null &&
    order.fulfillmentStatus?.code !== STORE_ORDER_CANCELLED_CODE
  );
}
