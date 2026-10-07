/**
 * R14 W3 (spec-3 §2) — what a committed shipment / pickup transition means for
 * a company order's stock and revenue recognition. Pure, so the routing is
 * unit-tested on its own; `FulfillmentRecognitionService` executes it.
 *
 *  - RESERVE   — goods left (shipped / out for delivery / pickup ready): hold the stock lines.
 *  - RECOGNIZE — control passed to the customer (delivered / pickup collected): invoice + stock issue + COGS.
 *  - UNWIND    — the parcel did not (or no longer) reach the customer (failed, needs reshipment, a
 *                `*RETURN*` catalog status, pickup cancelled / returned): release the reservation before
 *                recognition, flag RETURN_PENDING after it (the sales return is posted by a user, D3-3).
 */
export type RecognitionAction = 'RESERVE' | 'RECOGNIZE' | 'UNWIND' | 'NONE';

/** A shipment transition: the operational enum status plus the catalog code that was applied (if any). */
export function shipmentRecognitionAction(
  status: string | null | undefined,
  catalogCode?: string | null,
): RecognitionAction {
  // Administrator catalog statuses ("RETURNED", "RETURN_TO_SENDER", …) keep the
  // previous operational status — the code itself says the parcel came back.
  if (catalogCode && /RETURN/i.test(catalogCode)) return 'UNWIND';
  switch (status) {
    case 'SHIPPED':
    case 'OUT_FOR_DELIVERY':
      return 'RESERVE';
    case 'DELIVERED':
      return 'RECOGNIZE';
    case 'DELIVERY_FAILED':
    case 'NEEDS_RESHIPMENT':
      return 'UNWIND';
    default:
      return 'NONE';
  }
}

/** A pickup workflow transition (`StoreOrdersService.transitionPickup`). */
export function pickupRecognitionAction(code: string): RecognitionAction {
  switch (code) {
    case 'READY_FOR_PICKUP':
      return 'RESERVE';
    case 'COLLECTED':
      return 'RECOGNIZE';
    case 'CANCELLED':
    case 'RETURNED':
      return 'UNWIND';
    default:
      return 'NONE';
  }
}

/**
 * Delivered (shipment) or collected (pickup): the order's goods are with the
 * customer. A shipped order is judged by its latest attempt (callers load
 * shipments newest first) — an imported DELIVERED reaches the shipment without
 * moving the order status, and a permissive status change can move a delivered
 * parcel back to failed; the order's fulfillment code is the fallback when it
 * has no shipment row.
 */
export function isRecognitionDue(order: {
  fulfillmentMethod: string;
  fulfillmentStatus?: { code: string } | null;
  shipments?: Array<{ status: string | null }>;
}): boolean {
  const code = order.fulfillmentStatus?.code ?? '';
  if (order.fulfillmentMethod === 'PICKUP') return code === 'COLLECTED';
  const latest = order.shipments?.[0];
  if (latest) return latest.status === 'DELIVERED';
  return code === 'DELIVERED';
}
