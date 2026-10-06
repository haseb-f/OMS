/**
 * R13 — before/after proof of the migration. Compares two `r13-migration-dry-run`
 * JSON outputs (pre-migration database vs the same database after
 * `prisma migrate deploy`) and FAILS (exit 1) if any quantity, movement, cost
 * value or GL figure differs. The only allowed differences are the new columns
 * (supply method — which must equal the pre-migration projection) and the DRAFT
 * recipes copied from `product_components` (which must equal the projection too).
 *
 *   pnpm --dir apps/api exec ts-node scripts/r13/r13-before-after.ts \
 *     --before=../../specs/product-inventory-costing/evidence/dry-run-oms_r7_final.json \
 *     --after=../../specs/product-inventory-costing/evidence/dry-run-oms_r13_mig.json \
 *     --out=../../specs/product-inventory-costing/evidence/before-after.md [--json=<file>]
 *
 * Reads files only — no database access.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { arg } from './read-only-db';
import type { DryRunReport } from './dry-run-types';

type Kind = 'STRICT' | 'EXPECTED' | 'INFO';
interface Check {
  kind: Kind;
  name: string;
  before: unknown;
  after: unknown;
  ok: boolean;
  detail?: string;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

function compare(before: DryRunReport, after: DryRunReport): Check[] {
  const checks: Check[] = [];
  const add = (
    kind: Kind,
    name: string,
    b: unknown,
    a: unknown,
    detail?: string,
  ) => checks.push({ kind, name, before: b, after: a, ok: same(b, a), detail });
  const B = before.baseline;
  const A = after.baseline;

  // Strict: nothing that is history may change.
  add('STRICT', 'products.count', B.products.count, A.products.count);
  add('STRICT', 'products.deleted', B.products.deleted, A.products.deleted);
  add(
    'STRICT',
    'products.attributes (id, sku, type, item type, flags, owner, status, category, unit, barcode, investment flag)',
    B.products.attributeFingerprint,
    A.products.attributeFingerprint,
  );
  add('STRICT', 'movements.count', B.movements.count, A.movements.count);
  add('STRICT', 'movements.byType', B.movements.byType, A.movements.byType);
  add(
    'STRICT',
    'movements.rows (qty, before/after, cost@4dp, owner, reference, createdAt)',
    B.movements.fingerprint,
    A.movements.fingerprint,
  );
  const keys = new Set([...Object.keys(B.onHand), ...Object.keys(A.onHand)]);
  const changed = [...keys].filter((key) => B.onHand[key] !== A.onHand[key]);
  checks.push({
    kind: 'STRICT',
    name: 'onHand/reserved per product × warehouse',
    before: Object.keys(B.onHand).length,
    after: Object.keys(A.onHand).length,
    ok: changed.length === 0,
    detail:
      changed.length === 0
        ? 'all balances identical'
        : `${changed.length} differ: ${changed.slice(0, 10).join(', ')}`,
  });
  add('STRICT', 'onHand units', B.onHandUnits, A.onHandUnits);
  add(
    'STRICT',
    'company stock value',
    B.companyStockValue,
    A.companyStockValue,
  );
  for (const key of Object.keys(B.costs) as (keyof typeof B.costs)[]) {
    add('STRICT', `costs.${key}`, B.costs[key], A.costs[key]);
  }
  add('STRICT', 'gl.entries', B.gl.entries, A.gl.entries);
  add('STRICT', 'gl.lines', B.gl.lines, A.gl.lines);
  add('STRICT', 'gl.totalDebit', B.gl.totalDebit, A.gl.totalDebit);
  add('STRICT', 'gl.totalCredit', B.gl.totalCredit, A.gl.totalCredit);
  add(
    'STRICT',
    'gl.lines (account, debit, credit)',
    B.gl.linesFingerprint,
    A.gl.linesFingerprint,
  );
  add(
    'STRICT',
    'gl.inventory account balances',
    B.gl.inventoryAccounts,
    A.gl.inventoryAccounts,
  );
  add('STRICT', 'gl.COGS balance', B.gl.cogsBalance, A.gl.cogsBalance);
  add(
    'STRICT',
    'SALES_DELIVERY movement value',
    B.salesDeliveryCogs.movementValue,
    A.salesDeliveryCogs.movementValue,
  );
  add(
    'STRICT',
    'invoice line COGS',
    B.salesDeliveryCogs.invoiceLineCogs,
    A.salesDeliveryCogs.invoiceLineCogs,
  );
  if (A.legacyComponents.dropped) {
    // Dropped by the approved follow-up migration; its rows must have become the DRAFT recipes (checked below).
    add(
      'EXPECTED',
      'legacy product_components dropped (owner approval O3)',
      true,
      true,
    );
  } else {
    add(
      'STRICT',
      'legacy product_components preserved',
      B.legacyComponents,
      A.legacyComponents,
    );
  }

  // Expected (allowed) differences must match what the migration promised.
  const projectedDrafts = before.review.draftRecipesNeedingActivation.rows.map(
    (row) => `${row.productId}:${row.lines}`,
  );
  const createdDrafts = after.review.draftRecipesNeedingActivation.rows
    .filter((row) => row.migrated)
    .map((row) => `${row.productId}:${row.lines}`);
  checks.push({
    kind: 'EXPECTED',
    name: 'DRAFT recipes = legacy kits (one v1 per kit, same line count)',
    before: projectedDrafts.length,
    after: createdDrafts.length,
    ok:
      same([...projectedDrafts].sort(), [...createdDrafts].sort()) &&
      Object.keys(A.recipes.byStatus).every((status) => status === 'DRAFT'),
    detail: `after recipes by status ${JSON.stringify(A.recipes.byStatus)}`,
  });
  const counts = (report: DryRunReport) =>
    report.review.productCounts.map((row) => JSON.stringify(row)).sort();
  checks.push({
    kind: 'EXPECTED',
    name: 'supply method backfill = pre-migration projection (MANUFACTURED → ASSEMBLED, else PURCHASED)',
    before: before.meta.supplyMethodSource,
    after: after.meta.supplyMethodSource,
    ok: same(counts(before), counts(after)),
  });

  // Info: the review lists should not move.
  const reviewCount = (report: DryRunReport) =>
    Object.fromEntries(
      Object.entries(report.review)
        .filter(([key]) => key !== 'productCounts')
        .map(([key, value]) => [key, (value as { count: number }).count]),
    );
  add('INFO', 'review list sizes', reviewCount(before), reviewCount(after));
  return checks;
}

function markdown(
  before: DryRunReport,
  after: DryRunReport,
  checks: Check[],
): string {
  const failed = checks.filter((check) => !check.ok && check.kind !== 'INFO');
  const show = (value: unknown) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  };
  return `${[
    `# R13 migration — before / after`,
    '',
    `Before: \`${before.meta.database}\` (${before.meta.lastMigration}, R13 ${before.meta.r13Applied ? 'applied' : 'not applied'}) · ` +
      `After: \`${after.meta.database}\` (${after.meta.lastMigration}, R13 ${after.meta.r13Applied ? 'applied' : 'not applied'}).`,
    '',
    `Result: **${failed.length === 0 ? 'PASS' : 'FAIL'}** — ${checks.filter((c) => c.ok).length}/${checks.length} checks equal` +
      (failed.length
        ? `; failed: ${failed.map((c) => c.name).join('; ')}`
        : '.'),
    '',
    '| Kind | Check | Before | After | Equal |',
    '| --- | --- | --- | --- | --- |',
    ...checks.map(
      (check) =>
        `| ${check.kind} | ${check.name}${check.detail ? ` — ${check.detail}` : ''} | ${show(check.before).replace(/\|/g, '/')} | ${show(check.after).replace(/\|/g, '/')} | ${check.ok ? 'yes' : '**NO**'} |`,
    ),
    '',
  ].join('\n')}`;
}

function write(path: string, content: string) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
  return target;
}

function main() {
  const beforePath = arg('before');
  const afterPath = arg('after');
  if (!beforePath || !afterPath) {
    throw new Error('Usage: --before=<dry-run.json> --after=<dry-run.json>');
  }
  const before = JSON.parse(readFileSync(beforePath, 'utf8')) as DryRunReport;
  const after = JSON.parse(readFileSync(afterPath, 'utf8')) as DryRunReport;
  const checks = compare(before, after);
  const failed = checks.filter((check) => !check.ok && check.kind !== 'INFO');
  const out = arg('out');
  if (out) {
    process.stderr.write(
      `markdown → ${write(out, markdown(before, after, checks))}\n`,
    );
  }
  const json = arg('json');
  if (json) {
    process.stderr.write(
      `json → ${write(json, `${JSON.stringify({ before: before.meta, after: after.meta, ok: failed.length === 0, checks }, null, 2)}\n`)}\n`,
    );
  }
  for (const check of checks) {
    process.stdout.write(
      `${check.ok ? 'OK  ' : check.kind === 'INFO' ? 'INFO' : 'FAIL'} ${check.kind.padEnd(8)} ${check.name}${check.detail ? ` — ${check.detail}` : ''}\n`,
    );
  }
  process.stdout.write(
    `${failed.length === 0 ? 'PASS' : 'FAIL'}: ${before.meta.database} → ${after.meta.database}\n`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
}
