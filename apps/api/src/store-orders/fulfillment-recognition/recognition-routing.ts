/**
 * R14 W3 (spec-3 §2) / R15 W5a — what a committed shipment / pickup
 * transition means for a company order's revenue recognition. Pure, so the
 * routing is unit-tested on its own; `FulfillmentRecognitionService`
 * executes it. The physical steps (reservation, dispatch to transit, goods
 * coming back) are no longer recognition actions: `StoreOrderStockService`
 * runs them inside the shipment transaction.
 *
 *  - RESERVE        — pickup prepared: retry whatever is still unreserved.
 *  - RECOGNIZE      — control passed to the customer (a delivered shipment / pickup collected):
 *                     invoice + stock issue + COGS per delivered shipment.
 *  - RELEASE        — pickup cancelled before collection: the reservation is released.
 *  - RETURN_PENDING — the goods came back after delivery (a `*RETURN*` catalog status on a
 *                     delivered parcel, pickup RETURNED): flagged for the sales return (D15-10).
 *                     Before delivery a return code moves nothing — the goods stay in transit.
 */
export type RecognitionAction =
  'RESERVE' | 'RECOGNIZE' | 'RELEASE' | 'RETURN_PENDING' | 'NONE';

/** A shipment transition: the operational enum status plus the catalog code that was applied (if any). */
export function shipmentRecognitionAction(
  status: string | null | undefined,
  catalogCode?: string | null,
): RecognitionAction {
  // Administrator catalog statuses ("RETURNED", "RETURN_TO_SENDER", …) keep the
  // previous operational status — the code itself says the parcel came back.
  if (catalogCode && /RETURN/i.test(catalogCode)) return 'RETURN_PENDING';
  return status === 'DELIVERED' ? 'RECOGNIZE' : 'NONE';
}

/** A pickup workflow transition (`StoreOrdersService.transitionPickup`). */
export function pickupRecognitionAction(code: string): RecognitionAction {
  switch (code) {
    case 'READY_FOR_PICKUP':
      return 'RESERVE';
    case 'COLLECTED':
      return 'RECOGNIZE';
    case 'CANCELLED':
      return 'RELEASE';
    case 'RETURNED':
      return 'RETURN_PENDING';
    default:
      return 'NONE';
  }
}

/**
 * One invoice to issue (D15-5, D15-6): a delivered shipment with dispatched
 * lines (its accepted quantities, out of transit), or the whole order issued
 * from its warehouses — a collected pickup, a shipment delivered before R15
 * (no lines), or a delivered order with no shipment row at all.
 */
export interface RecognitionTarget {
  kind: 'SHIPMENT' | 'WHOLE_ORDER';
  /** The delivered shipment the invoice belongs to (`SalesInvoice.shipmentId`); null for a pickup / shipment-less order. */
  shipmentId: string | null;
}

export interface RecognitionTargetOrder {
  fulfillmentMethod: string;
  fulfillmentStatus?: { code: string } | null;
  shipments: Array<{
    id: string;
    attemptNumber: number;
    status: string | null;
    lines: Array<{ deliveredQuantity: number }>;
  }>;
  /** Live (non-cancelled) invoices of the order. */
  invoices: Array<{ shipmentId: string | null }>;
}

/**
 * Every invoice still due for the order, oldest attempt first. Each delivered
 * shipment is judged by its own current status (a permissive change can move
 * a delivered parcel back to failed); an order invoiced whole before R15
 * (`shipmentId` null) has nothing more due.
 */
export function recognitionTargets(
  order: RecognitionTargetOrder,
): RecognitionTarget[] {
  const code = order.fulfillmentStatus?.code ?? '';
  const wholeInvoiced = order.invoices.some((i) => i.shipmentId === null);
  if (order.fulfillmentMethod === 'PICKUP') {
    return code === 'COLLECTED' && !wholeInvoiced
      ? [{ kind: 'WHOLE_ORDER', shipmentId: null }]
      : [];
  }
  if (wholeInvoiced) return [];
  if (order.shipments.length === 0) {
    return code === 'DELIVERED' && order.invoices.length === 0
      ? [{ kind: 'WHOLE_ORDER', shipmentId: null }]
      : [];
  }
  const invoiced = new Set(order.invoices.map((i) => i.shipmentId));
  const targets: RecognitionTarget[] = [];
  for (const shipment of [...order.shipments].sort(
    (a, b) => a.attemptNumber - b.attemptNumber,
  )) {
    if (shipment.status !== 'DELIVERED' || invoiced.has(shipment.id)) continue;
    if (shipment.lines.length > 0) {
      if (shipment.lines.some((line) => line.deliveredQuantity > 0)) {
        targets.push({ kind: 'SHIPMENT', shipmentId: shipment.id });
      }
    } else if (
      order.invoices.length === 0 &&
      !targets.some((t) => t.kind === 'WHOLE_ORDER')
    ) {
      targets.push({ kind: 'WHOLE_ORDER', shipmentId: shipment.id });
    }
  }
  return targets;
}

/** Delivered (shipment) or collected (pickup) with an invoice still to issue. */
export function isRecognitionDue(order: RecognitionTargetOrder): boolean {
  return recognitionTargets(order).length > 0;
}
