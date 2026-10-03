import {
  Prisma,
  ShipmentStatus,
  StoreOrderActivitySource,
  StoreOrderShippingStage,
} from '@prisma/client';
import { evaluateFulfillmentGate } from '../store-order-fulfillment-gate';
import { lockStoreOrderRow } from '../store-order-payment-settlement.util';

/**
 * Round 6 SHIP — Sales → Shipping handoff.
 *
 * The internal Shipping queue (`GET /shipping`) lists Shipment rows, and
 * "Ready for shipping" is a Shipment attempt with `status = null`. That row
 * used to be created only lazily, when an operator acted on the order, so
 * eligible orders never reached the Shipping team. `ensureShippingQueued`
 * creates attempt #1 the moment an order becomes eligible and is called in
 * the same transaction by every path that can make it eligible (creation,
 * lead conversion, declared / verified payment recompute, amendments).
 *
 * It never advances a carrier state, never touches payments, accounting or
 * history, and never changes the fulfillment gate rules.
 */

/** `READY_FOR_SHIPPING` is the queue's name for an attempt with `status null`. */
export const READY_FOR_SHIPPING_FILTER = 'READY_FOR_SHIPPING';
export type ShipmentQueueStatus =
  ShipmentStatus | typeof READY_FOR_SHIPPING_FILTER;

/** Why a SHIPPING order is not in the Shipping queue (null = it is / can be). */
export type ShippingHandoffBlocker =
  | 'ORDER_ARCHIVED'
  | 'ORDER_CANCELLED'
  | 'ORDER_CLOSED'
  | 'PICKUP'
  | 'NOT_SHIPPABLE'
  | 'PAYMENT_REQUIRED';

export const SHIPPING_QUEUED_ACTIVITY = 'SHIPMENT_CREATED';
export const SHIPPING_QUEUED_REPAIR_ACTIVITY = 'SHIPPING_QUEUED_REPAIR';
export const SHIPPING_QUEUE_WITHDRAWN_ACTIVITY = 'SHIPPING_QUEUE_WITHDRAWN';

export const HANDOFF_ORDER_SELECT = {
  id: true,
  internalOrderId: true,
  deletedAt: true,
  fulfillmentMethod: true,
  shippingStage: true,
  paymentType: true,
  paymentStatus: true,
  declaredPaymentStatus: true,
  paymentStatusDef: { select: { code: true } },
  fulfillmentStatus: { select: { code: true, isFinal: true } },
} satisfies Prisma.StoreOrderSelect;

/** Blockers of an order whose fulfillment is over — its untouched attempt is not work. */
export const TERMINAL_BLOCKERS: ReadonlySet<ShippingHandoffBlocker> =
  new Set<ShippingHandoffBlocker>([
    'ORDER_ARCHIVED',
    'ORDER_CANCELLED',
    'ORDER_CLOSED',
  ]);

export type HandoffOrder = Prisma.StoreOrderGetPayload<{
  select: typeof HANDOFF_ORDER_SELECT;
}>;

export interface ShippingReadiness {
  eligible: boolean;
  blocker: ShippingHandoffBlocker | null;
  /** Human-readable reason (the fulfillment gate's own wording for payment). */
  reason: string | null;
}

/**
 * Pure eligibility rule. Pickup and digital-only orders (`shippingStage`
 * NOT_READY) never enter the carrier queue; the payment part is the single
 * `evaluateFulfillmentGate` rule, unchanged.
 */
export function evaluateShippingReadiness(
  order: Omit<HandoffOrder, 'id' | 'internalOrderId' | 'fulfillmentStatus'> & {
    /** `isFinal` optional for callers selecting the status label only. */
    fulfillmentStatus: { code: string; isFinal?: boolean } | null;
  },
): ShippingReadiness {
  if (order.deletedAt) {
    return blocked('ORDER_ARCHIVED', 'The order is archived.');
  }
  if (order.fulfillmentStatus?.code === 'CANCELLED') {
    return blocked('ORDER_CANCELLED', 'The order is cancelled.');
  }
  if (order.fulfillmentStatus?.isFinal) {
    return blocked(
      'ORDER_CLOSED',
      `Fulfillment is already final (${order.fulfillmentStatus.code}).`,
    );
  }
  if (order.fulfillmentMethod === 'PICKUP') {
    return blocked(
      'PICKUP',
      'Pickup orders are prepared for collection and never enter the Shipping queue.',
    );
  }
  if (order.shippingStage !== StoreOrderShippingStage.READY_FOR_SHIPPING) {
    return blocked(
      'NOT_SHIPPABLE',
      'Nothing to ship (digital-only order or not ready for shipping).',
    );
  }
  const gate = evaluateFulfillmentGate({
    paymentType: order.paymentType,
    declaredPaymentStatus: order.declaredPaymentStatus,
    paymentStatus: order.paymentStatus,
    paymentStatusCode: order.paymentStatusDef?.code ?? null,
  });
  if (!gate.allowed) return blocked('PAYMENT_REQUIRED', gate.reason);
  return { eligible: true, blocker: null, reason: null };
}

function blocked(
  blocker: ShippingHandoffBlocker,
  reason: string | null,
): ShippingReadiness {
  return { eligible: false, blocker, reason };
}

/**
 * An attempt nobody has worked on yet: no carrier/catalog status, company,
 * tracking, label, notes, cost, evidence or carrier charge. Only such an
 * attempt may be withdrawn (soft-deleted) or restored automatically, and it
 * does not count as "fulfillment started".
 */
export const UNTOUCHED_ATTEMPT_WHERE = {
  status: null,
  shippingStatusId: null,
  shippingCompanyId: null,
  trackingNumber: null,
  labelUrl: null,
  notes: null,
  baseShippingCost: null,
  additionalShippingCost: null,
  costPaidBy: null,
  isReship: false,
  labelReissueRequired: false,
  receiptAttachments: { none: {} },
  attachments: { none: {} },
  carrierCharges: { none: {} },
  lastExternalSyncAt: null,
} satisfies Prisma.ShipmentWhereInput;

/**
 * First attempt for an order with no live Shipment: restores an untouched
 * attempt that was withdrawn earlier (keeps #1 numbering), else creates the
 * next numbered attempt. Caller holds the order lock and checked the gate.
 */
export async function createOrRestoreAttempt(
  tx: Prisma.TransactionClient,
  storeOrderId: string,
  isReship: boolean,
) {
  if (!isReship) {
    const withdrawn = await tx.shipment.findFirst({
      where: {
        storeOrderId,
        deletedAt: { not: null },
        ...UNTOUCHED_ATTEMPT_WHERE,
      },
      orderBy: { attemptNumber: 'asc' },
    });
    if (withdrawn) {
      return tx.shipment.update({
        where: { id: withdrawn.id },
        data: { deletedAt: null },
      });
    }
  }
  const previousCount = await tx.shipment.count({ where: { storeOrderId } });
  return tx.shipment.create({
    data: { storeOrderId, isReship, attemptNumber: previousCount + 1 },
  });
}

export interface HandoffOptions {
  actorId?: string | null;
  /** Audited as SHIPPING_QUEUED_REPAIR (R6 repair script). */
  repair?: boolean;
  /** Activity channel tag (the repair runs as BULK). */
  source?: StoreOrderActivitySource;
}

export type ShippingHandoffOutcome =
  'QUEUED' | 'ALREADY_IN_SHIPPING' | 'WITHDRAWN' | 'BLOCKED' | 'NOT_FOUND';

export interface ShippingHandoffResult extends ShippingReadiness {
  outcome: ShippingHandoffOutcome;
  shipmentId: string | null;
  internalOrderId: string | null;
}

/**
 * Idempotent, concurrency-safe handoff (must run inside a transaction):
 * - eligible + no live Shipment → attempt #1 with `status null` (Ready for
 *   shipping) and a SHIPMENT_CREATED activity;
 * - no longer eligible (archived, cancelled, switched to pickup, prepaid
 *   basis withdrawn) + only an UNTOUCHED attempt → that attempt is
 *   soft-deleted (audited). A worked-on attempt is never touched.
 */
export async function ensureShippingQueued(
  tx: Prisma.TransactionClient,
  storeOrderId: string,
  options: HandoffOptions = {},
): Promise<ShippingHandoffResult> {
  // The order row lock every payment / shipment path already uses: two
  // concurrent callers can never both see "no Shipment" and insert twice.
  await lockStoreOrderRow(tx, storeOrderId);
  const order = await tx.storeOrder.findUnique({
    where: { id: storeOrderId },
    select: HANDOFF_ORDER_SELECT,
  });
  if (!order) {
    return {
      eligible: false,
      blocker: null,
      reason: 'Store Order not found.',
      outcome: 'NOT_FOUND',
      shipmentId: null,
      internalOrderId: null,
    };
  }
  const readiness = evaluateShippingReadiness(order);
  const result = (
    outcome: ShippingHandoffOutcome,
    shipmentId: string | null,
  ): ShippingHandoffResult => ({
    ...readiness,
    outcome,
    shipmentId,
    internalOrderId: order.internalOrderId,
  });

  const live = await tx.shipment.findFirst({
    where: { storeOrderId, deletedAt: null },
    orderBy: { attemptNumber: 'desc' },
    select: { id: true, attemptNumber: true },
  });

  if (live) {
    if (readiness.eligible) return result('ALREADY_IN_SHIPPING', live.id);
    // Conditional soft-delete: a concurrent operator write (company,
    // tracking, attachment…) makes the predicate fail and nothing changes.
    const withdrawn = await tx.shipment.updateMany({
      where: { id: live.id, deletedAt: null, ...UNTOUCHED_ATTEMPT_WHERE },
      data: { deletedAt: new Date(), updatedBy: options.actorId ?? null },
    });
    if (withdrawn.count !== 1) return result('ALREADY_IN_SHIPPING', live.id);
    await tx.storeOrderActivity.create({
      data: {
        storeOrderId,
        action: SHIPPING_QUEUE_WITHDRAWN_ACTIVITY,
        details: `Shipment #${live.attemptNumber} withdrawn from the Shipping queue before any work — ${readiness.reason ?? readiness.blocker}`,
        performedById: options.actorId ?? null,
        ...(options.source ? { source: options.source } : {}),
      },
    });
    return result('WITHDRAWN', null);
  }

  if (!readiness.eligible) return result('BLOCKED', null);

  const shipment = await createOrRestoreAttempt(tx, storeOrderId, false);
  await tx.storeOrderActivity.create({
    data: {
      storeOrderId,
      action: options.repair
        ? SHIPPING_QUEUED_REPAIR_ACTIVITY
        : SHIPPING_QUEUED_ACTIVITY,
      details: options.repair
        ? `Shipment #${shipment.attemptNumber} queued for Shipping (Ready for shipping) — R6 handoff repair`
        : `Shipment #${shipment.attemptNumber} queued for Shipping (Ready for shipping)`,
      performedById: options.actorId ?? null,
      ...(options.source ? { source: options.source } : {}),
    },
  });
  return result('QUEUED', shipment.id);
}

/** Read-only view of the handoff for an order (detail page, agent portal). */
export async function readShippingHandoff(
  client: Prisma.TransactionClient,
  storeOrderId: string,
): Promise<
  (ShippingReadiness & { queued: boolean; applicable: boolean }) | null
> {
  const order = await client.storeOrder.findUnique({
    where: { id: storeOrderId },
    select: {
      ...HANDOFF_ORDER_SELECT,
      shipments: {
        where: { deletedAt: null },
        select: { id: true },
      },
    },
  });
  if (!order) return null;
  const readiness = evaluateShippingReadiness(order);
  let queued = order.shipments.length > 0;
  // Same rule as the queue list: an untouched attempt of an archived /
  // cancelled / closed order is not in the Shipping queue.
  if (queued && readiness.blocker && TERMINAL_BLOCKERS.has(readiness.blocker)) {
    const worked = await client.shipment.count({
      where: {
        storeOrderId,
        deletedAt: null,
        NOT: UNTOUCHED_ATTEMPT_WHERE,
      },
    });
    queued = worked > 0;
  }
  return {
    ...readiness,
    queued,
    applicable: order.fulfillmentMethod === 'SHIPPING',
  };
}
