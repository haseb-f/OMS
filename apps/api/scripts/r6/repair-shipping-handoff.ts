/**
 * R6 SHIP — repair of the Sales → Shipping handoff.
 *
 * Before R6, an eligible shipping order (converted lead or direct order,
 * company or agent) reached the internal Shipping queue only after an
 * operator acted on it, so many sat invisible. This lists every order that
 * is eligible NOW (not archived, not in a final fulfillment state, SHIPPING,
 * Ready for Shipping, the unchanged fulfillment gate passes) and has no live
 * Shipment row.
 *
 *   dry run (default):  pnpm --filter api exec ts-node scripts/r6/repair-shipping-handoff.ts
 *   apply:              pnpm --filter api exec ts-node scripts/r6/repair-shipping-handoff.ts --apply [--actor=<user email>]
 *
 * `--apply` runs the same `ensureShippingQueued` the live paths use, one
 * transaction per order, and records a `SHIPPING_QUEUED_REPAIR` order
 * activity (channel BULK; performed by `--actor` when given). Idempotent
 * (a second run finds nothing). Never touches payments, journals, statuses
 * or history — it only adds the queue entry.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  applyShippingHandoffRepair,
  planShippingHandoffRepair,
} from '../../src/store-orders/shipments/shipping-handoff-repair';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const apply = process.argv.includes('--apply');
  const actorEmail = process.argv
    .find((arg) => arg.startsWith('--actor='))
    ?.slice('--actor='.length);
  const database = new URL(
    process.env.DATABASE_URL ?? 'postgres://unknown',
  ).pathname.replace(/^\//, '');
  console.log(
    `R6 shipping handoff repair — ${apply ? 'APPLY' : 'DRY RUN'} — database "${database}"`,
  );

  const plan = await planShippingHandoffRepair(prisma);
  const { eligible } = plan;
  console.log(`Shipping orders without a Shipment row: ${plan.candidates}`);
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
  const blocked = Object.entries(plan.blocked).sort();
  if (blocked.length === 0) console.log('  none');
  for (const [reason, count] of blocked) console.log(`  ${reason}: ${count}`);

  if (!apply) {
    console.log(
      'Dry run only — re-run with --apply to queue the eligible orders.',
    );
    return;
  }

  const actorId = actorEmail
    ? (
        await prisma.user.findUniqueOrThrow({
          where: { email: actorEmail },
          select: { id: true },
        })
      ).id
    : null;
  const { outcomes, perOrder } = await applyShippingHandoffRepair(
    prisma,
    plan,
    actorId,
  );
  for (const row of perOrder) {
    console.log(`  ${row.internalOrderId}: ${row.outcome}`);
  }
  console.log(`Applied: ${JSON.stringify(outcomes)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
