/**
 * R6 SHIP — repair of the Sales → Shipping handoff.
 *
 * Before R6, an eligible shipping order (converted lead or direct order,
 * company or agent) reached the internal Shipping queue only after an
 * operator acted on it, so many sat invisible. This lists every order that
 * is eligible NOW (not archived/cancelled, SHIPPING, Ready for Shipping, the
 * unchanged fulfillment gate passes) and has no live Shipment row.
 *
 *   dry run (default):  pnpm --filter api exec ts-node scripts/r6/repair-shipping-handoff.ts
 *   apply:              pnpm --filter api exec ts-node scripts/r6/repair-shipping-handoff.ts --apply
 *
 * `--apply` runs the same `ensureShippingQueued` the live paths use, one
 * transaction per order, and records a `SHIPPING_QUEUED_REPAIR` order
 * activity. Idempotent (a second run finds nothing). Never touches
 * payments, journals, statuses or history — it only adds the queue entry.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  ensureShippingQueued,
  evaluateShippingReadiness,
  HANDOFF_ORDER_SELECT,
  type ShippingHandoffBlocker,
} from '../../src/store-orders/shipments/shipping-handoff';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const apply = process.argv.includes('--apply');
  const database = new URL(
    process.env.DATABASE_URL ?? 'postgres://unknown',
  ).pathname.replace(/^\//, '');
  console.log(
    `R6 shipping handoff repair — ${apply ? 'APPLY' : 'DRY RUN'} — database "${database}"`,
  );

  // Shipping orders with no live Shipment row (worked or queued).
  const candidates = await prisma.storeOrder.findMany({
    where: {
      fulfillmentMethod: 'SHIPPING',
      shipments: { none: { deletedAt: null } },
    },
    select: { ...HANDOFF_ORDER_SELECT, agentId: true, leadId: true },
    orderBy: { createdAt: 'asc' },
  });

  const eligible: typeof candidates = [];
  const blocked = new Map<ShippingHandoffBlocker, number>();
  for (const order of candidates) {
    const readiness = evaluateShippingReadiness(order);
    if (readiness.eligible) {
      eligible.push(order);
    } else if (readiness.blocker) {
      blocked.set(readiness.blocker, (blocked.get(readiness.blocker) ?? 0) + 1);
    }
  }

  console.log(`Shipping orders without a Shipment row: ${candidates.length}`);
  console.log(
    `Eligible now (missing from the Shipping queue): ${eligible.length}`,
  );
  const byKind = {
    companyFromLead: eligible.filter((o) => !o.agentId && o.leadId).length,
    companyDirect: eligible.filter((o) => !o.agentId && !o.leadId).length,
    agentFromLead: eligible.filter((o) => o.agentId && o.leadId).length,
    agentDirect: eligible.filter((o) => o.agentId && !o.leadId).length,
  };
  console.log(`  by origin: ${JSON.stringify(byKind)}`);
  if (eligible.length > 0) {
    console.log(
      `  orders: ${eligible.map((o) => o.internalOrderId).join(', ')}`,
    );
  }
  console.log('Blocked (correctly not queued), by reason:');
  if (blocked.size === 0) console.log('  none');
  for (const [reason, count] of [...blocked.entries()].sort()) {
    console.log(`  ${reason}: ${count}`);
  }

  if (!apply) {
    console.log(
      'Dry run only — re-run with --apply to queue the eligible orders.',
    );
    return;
  }

  const outcomes = new Map<string, number>();
  for (const order of eligible) {
    const result = await prisma.$transaction((tx) =>
      ensureShippingQueued(tx, order.id, { repair: true }),
    );
    outcomes.set(result.outcome, (outcomes.get(result.outcome) ?? 0) + 1);
    console.log(`  ${order.internalOrderId}: ${result.outcome}`);
  }
  console.log(`Applied: ${JSON.stringify(Object.fromEntries(outcomes))}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
