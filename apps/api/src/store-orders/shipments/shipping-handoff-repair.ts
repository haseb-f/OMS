import { Prisma, StoreOrderActivitySource } from '@prisma/client';
import {
  ensureShippingQueued,
  evaluateShippingReadiness,
  HANDOFF_ORDER_SELECT,
  type ShippingHandoffBlocker,
  type ShippingHandoffOutcome,
} from './shipping-handoff';

/** The client the repair needs: reads plus interactive transactions. */
type RepairClient = Prisma.TransactionClient & {
  $transaction<R>(fn: (tx: Prisma.TransactionClient) => Promise<R>): Promise<R>;
};

export interface ShippingHandoffRepairPlan {
  /** Shipping orders with no live Shipment row. */
  candidates: number;
  eligible: Array<{
    id: string;
    internalOrderId: string;
    agentId: string | null;
    leadId: string | null;
  }>;
  /** Correctly not queued, by reason (archived, cancelled, final, pickup, payment…). */
  blocked: Partial<Record<ShippingHandoffBlocker, number>>;
}

/**
 * R6 SHIP repair, dry-run half: every shipping order that is eligible NOW
 * (same rule as the live handoff — final fulfillment states, archived,
 * digital-only and unpaid prepaid are blocked) and has no live Shipment.
 */
export async function planShippingHandoffRepair(
  client: Prisma.TransactionClient,
): Promise<ShippingHandoffRepairPlan> {
  const candidates = await client.storeOrder.findMany({
    where: {
      fulfillmentMethod: 'SHIPPING',
      shipments: { none: { deletedAt: null } },
    },
    select: { ...HANDOFF_ORDER_SELECT, agentId: true, leadId: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const plan: ShippingHandoffRepairPlan = {
    candidates: candidates.length,
    eligible: [],
    blocked: {},
  };
  for (const order of candidates) {
    const readiness = evaluateShippingReadiness(order);
    if (readiness.eligible) {
      plan.eligible.push({
        id: order.id,
        internalOrderId: order.internalOrderId,
        agentId: order.agentId,
        leadId: order.leadId,
      });
    } else if (readiness.blocker) {
      plan.blocked[readiness.blocker] =
        (plan.blocked[readiness.blocker] ?? 0) + 1;
    }
  }
  return plan;
}

/**
 * Apply half: the live `ensureShippingQueued`, one transaction per order,
 * audited as SHIPPING_QUEUED_REPAIR (channel BULK, optional actor).
 * Idempotent — a second run finds nothing to queue. Never touches payments,
 * journals, statuses or history.
 */
export async function applyShippingHandoffRepair(
  client: RepairClient,
  plan: ShippingHandoffRepairPlan,
  actorId: string | null = null,
) {
  const outcomes: Partial<Record<ShippingHandoffOutcome, number>> = {};
  const perOrder: Array<{ internalOrderId: string; outcome: string }> = [];
  for (const order of plan.eligible) {
    const result = await client.$transaction((tx) =>
      ensureShippingQueued(tx, order.id, {
        repair: true,
        actorId,
        source: StoreOrderActivitySource.BULK,
      }),
    );
    outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
    perOrder.push({
      internalOrderId: order.internalOrderId,
      outcome: result.outcome,
    });
  }
  return { outcomes, perOrder };
}
