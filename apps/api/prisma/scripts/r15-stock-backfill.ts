/**
 * R15 W5a (spec §7, decision D15-20) — brings the store orders created before
 * R15 (`stockStatus` PENDING, not archived) to the stock lifecycle through the
 * SAME `StockBackfillService` / `StoreOrderStockService` as
 * `POST /store-orders/stock-backfill`: open orders reserve their lines (SHORT
 * when not possible), shipped-not-delivered orders move their quantities to
 * the goods-in-transit warehouse (releasing the R14 shipment reservation),
 * delivered / issued orders are marked from their movements.
 *
 *   cd apps/api
 *   npx ts-node --transpile-only prisma/scripts/r15-stock-backfill.ts            # dry run (default)
 *   APPLY=1 BACKFILL_ACTOR_EMAIL=... npx ts-node --transpile-only prisma/scripts/r15-stock-backfill.ts
 *
 * Env:
 *   APPLY=1                 apply (default: dry run — nothing is written)
 *   BACKFILL_ACTOR_EMAIL    user recorded as createdBy (default: the oldest active super admin)
 *   BACKFILL_ORDER_IDS      comma-separated store order ids to limit the run (default: every PENDING order)
 *   BACKFILL_OUT            report path (default: specs/round15-completion/evidence/
 *                           r15-stock-backfill-<dry-run|apply>-<timestamp>.json at the repo root)
 *
 * Safety: the dry run only reads. Apply writes reservation / transfer movements (no journal:
 * goods in transit stay inventory at the same moving average). Idempotent: a second apply finds
 * no PENDING order. Orders that cannot be secured are reported (SHORT), never forced.
 */
import 'dotenv/config';
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StockBackfillService } from '../../src/store-orders/stock-lifecycle/stock-backfill.service';

async function main() {
  const apply = process.env.APPLY === '1';
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService, { strict: false });
    const backfill = app.get(StockBackfillService, { strict: false });
    const email = process.env.BACKFILL_ACTOR_EMAIL;
    const actor = await prisma.user.findFirst({
      where: email
        ? { email, deletedAt: null }
        : { isSuperAdmin: true, isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, isSuperAdmin: true },
    });
    if (apply && !actor?.isSuperAdmin) {
      throw new Error(
        'APPLY=1 needs a super admin actor (BACKFILL_ACTOR_EMAIL or an active super admin).',
      );
    }
    const orderIds = process.env.BACKFILL_ORDER_IDS?.split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const report = await backfill.run({
      dryRun: !apply,
      userId: actor?.id,
      orderIds: orderIds?.length ? orderIds : undefined,
    });
    const stamp = report.generatedAt.replace(/[:.]/g, '-');
    const out = resolve(
      process.env.BACKFILL_OUT ??
        resolve(
          __dirname,
          '../../../../specs/round15-completion/evidence',
          `r15-stock-backfill-${apply ? 'apply' : 'dry-run'}-${stamp}.json`,
        ),
    );
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      JSON.stringify({ actor: actor?.email ?? null, ...report }, null, 2),
    );
    console.log(JSON.stringify(report.summary, null, 2));
    console.log(`Report written to ${out}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
