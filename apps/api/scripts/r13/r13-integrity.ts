/**
 * R13 — inventory integrity report (invariants I1–I7, spec §8) from the CLI.
 * Same service as `GET /inventory/integrity`; READ-ONLY session.
 *
 *   DATABASE_URL=postgresql://oms:oms@localhost:5434/oms_r13 \
 *     pnpm --dir apps/api exec ts-node scripts/r13/r13-integrity.ts \
 *       --out=../../specs/product-inventory-costing/evidence/integrity-oms_r13.md \
 *       [--json=<file.json>] [--products=<id,id>] [--warehouse=<id>] [--fail-on=FAIL|WARN|never] [--quiet]
 *
 * Prints the JSON report to stdout (unless --quiet), writes the markdown
 * summary to --out and the JSON to --json. Exit 1 when the overall status
 * reaches --fail-on (default FAIL).
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { AccountMappingService } from '../../src/accounting/account-mapping/account-mapping.service';
import { InventoryValuationService } from '../../src/accounting/inventory-valuation/inventory-valuation.service';
import { InventoryIntegrityService } from '../../src/inventory/integrity/inventory-integrity.service';
import { renderIntegrityMarkdown } from '../../src/inventory/integrity/integrity-rules';
import type { IntegrityStatus } from '../../src/inventory/integrity/integrity.types';
import {
  arg,
  assertAllowedDatabase,
  flag,
  readOnlyClient,
} from './read-only-db';

function write(path: string, content: string) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
  return target;
}

async function main() {
  const url = process.env.DATABASE_URL;
  const target = assertAllowedDatabase(url, {
    allowRemote: flag('allow-remote'),
  });
  const prisma = readOnlyClient(url!);
  const db = prisma as unknown as PrismaService;
  try {
    const service = new InventoryIntegrityService(
      db,
      new AccountMappingService(db),
      new InventoryValuationService(db),
    );
    const report = await service.run({
      productIds: arg('products')
        ?.split(',')
        .map((id) => id.trim())
        .filter(Boolean),
      warehouseId: arg('warehouse') || undefined,
    });
    const full = { database: target.database, host: target.host, ...report };
    const json = `${JSON.stringify(full, null, 2)}\n`;
    if (!flag('quiet')) process.stdout.write(json);
    const out = arg('out');
    if (out) {
      const path = write(
        out,
        renderIntegrityMarkdown(
          report,
          `Inventory integrity — database "${target.database}"`,
        ),
      );
      process.stderr.write(`markdown → ${path}\n`);
    }
    const jsonOut = arg('json');
    if (jsonOut) {
      process.stderr.write(`json → ${write(jsonOut, json)}\n`);
    }
    process.stderr.write(
      `${target.database}: ${report.status} — ${report.invariants
        .map((inv) => `${inv.id} ${inv.status}`)
        .join(', ')}\n`,
    );
    const failOn = (arg('fail-on') ?? 'FAIL').toUpperCase();
    const rank: Record<IntegrityStatus, number> = { PASS: 0, WARN: 1, FAIL: 2 };
    if (
      failOn !== 'NEVER' &&
      rank[report.status] >= (rank[failOn as IntegrityStatus] ?? 2)
    ) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
});
