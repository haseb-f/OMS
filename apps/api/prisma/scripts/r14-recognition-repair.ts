/**
 * R14 W3 (spec-3 §6) — recognise delivered / collected company store orders
 * that were never invoiced (the former "fully paid" gate), through the SAME
 * `RecognitionRepairService` / `FulfillmentRecognitionService` the delivery
 * hooks and `POST /store-orders/recognition-repair` use.
 *
 *   cd apps/api
 *   npx ts-node --transpile-only prisma/scripts/r14-recognition-repair.ts            # dry run (default)
 *   APPLY=1 REPAIR_ACTOR_EMAIL=... npx ts-node --transpile-only prisma/scripts/r14-recognition-repair.ts
 *
 * Env:
 *   APPLY=1               apply (default: dry run — nothing is written)
 *   REPAIR_ACTOR_EMAIL    user recorded as createdBy (default: the oldest active super admin)
 *   REPAIR_ORDER_IDS      comma-separated store order ids to limit the scan (default: every delivered order)
 *   REPAIR_OUT            report path (default: specs/round14-production-readiness/evidence/
 *                         r14-recognition-repair-<dry-run|apply>-<timestamp>.json at the repo root)
 *
 * Safety: the dry run only reads. Apply creates sales invoices, stock movements and journal
 * entries for delivered orders (a change to financial records — on Production only with the
 * owner's go-ahead, decision D3-2). Orders with blockers (missing cost / stock / mapping /
 * warehouse, inactive product) are reported, never forced. Idempotent: a second apply is a
 * no-op. Existing receipts are never re-posted; verified advances are allocated to the new
 * invoice by the existing collection service.
 */
import 'dotenv/config';
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RecognitionRepairService } from '../../src/store-orders/fulfillment-recognition/recognition-repair.service';

async function main() {
  const apply = process.env.APPLY === '1';
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService, { strict: false });
    const repair = app.get(RecognitionRepairService, { strict: false });
    const email = process.env.REPAIR_ACTOR_EMAIL;
    const actor = await prisma.user.findFirst({
      where: email
        ? { email, deletedAt: null }
        : { isSuperAdmin: true, isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, isSuperAdmin: true },
    });
    if (apply && !actor?.isSuperAdmin) {
      throw new Error(
        'APPLY=1 needs a super admin actor (REPAIR_ACTOR_EMAIL or an active super admin).',
      );
    }
    const orderIds = process.env.REPAIR_ORDER_IDS?.split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const report = await repair.run({
      dryRun: !apply,
      userId: actor?.id,
      orderIds: orderIds?.length ? orderIds : undefined,
    });
    const stamp = report.generatedAt.replace(/[:.]/g, '-');
    const out = resolve(
      process.env.REPAIR_OUT ??
        resolve(
          __dirname,
          '../../../../specs/round14-production-readiness/evidence',
          `r14-recognition-repair-${apply ? 'apply' : 'dry-run'}-${stamp}.json`,
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
