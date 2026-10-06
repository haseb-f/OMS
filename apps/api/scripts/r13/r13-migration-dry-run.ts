/**
 * R13 — migration dry run (READ-ONLY session; spec §2/§3, migration.md).
 * Works on a database before OR after the R13 migration (it detects the new
 * columns/tables) and reports, for owner review: product classification counts,
 * unclassified items, legacy type ↔ attribute inconsistencies, assembled / kit
 * products and their recipes, DRAFT recipes needing activation, barcode
 * duplicates, stock without cost, investment eligibility the new rule would
 * block (grandfathered, never changed), agent stock with company GL postings —
 * plus a reconciliation BASELINE (quantities, movements, cost values, GL) that
 * `r13-before-after.ts` compares between the pre- and post-migration database.
 *
 *   DATABASE_URL=postgresql://oms:oms@localhost:5434/oms_r7_final \
 *     pnpm --dir apps/api exec ts-node scripts/r13/r13-migration-dry-run.ts \
 *       --json=../../specs/product-inventory-costing/evidence/dry-run-oms_r7_final.json \
 *       --out=../../specs/product-inventory-costing/evidence/dry-run-oms_r7_final.md
 *
 * Never writes: the session runs with default_transaction_read_only=on.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import {
  ItemType,
  Prisma,
  type PrismaClient,
  ProductSupplyMethod,
} from '@prisma/client';
import {
  deriveLegacyProductType,
  findProductRuleViolation,
} from '../../src/products/product-attributes';
import {
  arg,
  assertAllowedDatabase,
  flag,
  readOnlyClient,
} from './read-only-db';
import type {
  DryRunReport,
  ProductCountRow,
  ProductRef,
} from './dry-run-types';

type Row = Record<string, unknown>;
const LIST_CAP = 200;
const RESERVATIONS = Prisma.sql`('RESERVATION', 'RESERVATION_RELEASE')`;

const num = (value: unknown): number =>
  typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
const str = (value: unknown): string =>
  value === null || value === undefined
    ? ''
    : Prisma.Decimal.isDecimal(value)
      ? value.toString()
      : typeof value === 'string'
        ? value
        : typeof value === 'number' ||
            typeof value === 'boolean' ||
            typeof value === 'bigint'
          ? `${value}`
          : value instanceof Date
            ? value.toISOString()
            : JSON.stringify(value);
const money = (value: unknown) =>
  new Prisma.Decimal(str(value) || 0).toFixed(2);
const listing = <T>(rows: T[]) => ({
  count: rows.length,
  rows: rows.slice(0, LIST_CAP),
});

async function exists(
  db: PrismaClient,
  table: string,
  column?: string,
): Promise<boolean> {
  const rows = await db.$queryRaw<{ found: boolean }[]>(
    column
      ? Prisma.sql`SELECT EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}) AS found`
      : Prisma.sql`SELECT EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ${table}) AS found`,
  );
  return rows[0]?.found === true;
}

async function review(
  db: PrismaClient,
  r13: boolean,
): Promise<DryRunReport['review']> {
  const supply = r13
    ? Prisma.sql`p.supply_method::text`
    : Prisma.sql`CASE WHEN p.type = 'MANUFACTURED' THEN 'ASSEMBLED' ELSE 'PURCHASED' END`;
  const products = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT p.id, p.sku, p.name, p.type::text AS type, p.item_type::text AS item_type, ${supply} AS supply_method,
           p.is_inventory_item, p.is_sellable, p.is_purchasable, p.owner_agent_id IS NOT NULL AS agent_owned,
           p.status::text AS status, p.deleted_at IS NOT NULL AS deleted
    FROM products p ORDER BY p.sku`);
  const ref = (row: Row): ProductRef => ({
    id: str(row.id),
    sku: str(row.sku),
    name: str(row.name),
    type: str(row.type),
    itemType: row.item_type === null ? null : str(row.item_type),
    supplyMethod: str(row.supply_method),
    isInventoryItem: row.is_inventory_item === true,
    isSellable: row.is_sellable === true,
    isPurchasable: row.is_purchasable === true,
    status: str(row.status),
  });

  const counts = new Map<string, ProductCountRow>();
  for (const row of products) {
    const item: Omit<ProductCountRow, 'count'> = {
      itemType: row.item_type === null ? null : str(row.item_type),
      supplyMethod: str(row.supply_method),
      isInventoryItem: row.is_inventory_item === true,
      isSellable: row.is_sellable === true,
      isPurchasable: row.is_purchasable === true,
      agentOwned: row.agent_owned === true,
      legacyType: str(row.type),
      deleted: row.deleted === true,
    };
    const key = JSON.stringify(item);
    const current = counts.get(key);
    counts.set(key, { ...item, count: (current?.count ?? 0) + 1 });
  }
  const live = products.filter((row) => row.deleted !== true);

  const legacyType: (ProductRef & { derivedType: string })[] = [];
  const ruleViolations: (ProductRef & { code: string })[] = [];
  for (const row of live) {
    if (row.item_type === null) continue;
    const attributes = {
      itemType: str(row.item_type) as ItemType,
      supplyMethod: str(row.supply_method) as ProductSupplyMethod,
      isInventoryItem: row.is_inventory_item === true,
      isSellable: row.is_sellable === true,
      isPurchasable: row.is_purchasable === true,
    };
    const derived = deriveLegacyProductType(
      attributes.itemType,
      attributes,
      attributes.supplyMethod,
    );
    if (derived !== str(row.type)) {
      legacyType.push({ ...ref(row), derivedType: derived });
    }
    const violation = findProductRuleViolation(attributes);
    if (violation) ruleViolations.push({ ...ref(row), code: violation.code });
  }

  const recipeCounts = r13
    ? await db.$queryRaw<Row[]>(Prisma.sql`
        SELECT product_id, status::text AS status, COUNT(*)::int AS n FROM product_recipes GROUP BY 1, 2`)
    : [];
  const componentCounts = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT kit_product_id, COUNT(*)::int AS n FROM product_components GROUP BY 1`);
  const componentsOf = new Map(
    componentCounts.map((row) => [str(row.kit_product_id), num(row.n)]),
  );
  const recipesOf = new Map<string, Record<string, number>>();
  for (const row of recipeCounts) {
    const id = str(row.product_id);
    recipesOf.set(id, {
      ...(recipesOf.get(id) ?? {}),
      [str(row.status)]: num(row.n),
    });
  }
  const assembled = live
    .filter(
      (row) =>
        str(row.supply_method) !== 'PURCHASED' ||
        str(row.type) === 'MANUFACTURED' ||
        componentsOf.has(str(row.id)),
    )
    .map((row) => ({
      ...ref(row),
      legacyComponents: componentsOf.get(str(row.id)) ?? 0,
      recipes: recipesOf.get(str(row.id)) ?? {},
    }));

  type DraftRow =
    DryRunReport['review']['draftRecipesNeedingActivation']['rows'][number];
  const drafts: DraftRow[] = r13
    ? (
        await db.$queryRaw<Row[]>(Prisma.sql`
          SELECT r.product_id, p.sku, p.name, p.supply_method::text AS supply_method, r.version,
                 (SELECT COUNT(*)::int FROM product_recipe_lines l WHERE l.recipe_id = r.id) AS lines,
                 COALESCE(r.notes LIKE 'Migrated from legacy product_components%', false) AS migrated
          FROM product_recipes r JOIN products p ON p.id = r.product_id
          WHERE r.status = 'DRAFT' ORDER BY p.sku, r.version`)
      ).map((row) => ({
        productId: str(row.product_id),
        sku: str(row.sku),
        name: str(row.name),
        supplyMethod: str(row.supply_method),
        version: num(row.version),
        lines: num(row.lines),
        migrated: row.migrated === true,
      }))
    : // Pre-migration: what the migration WILL create (one DRAFT v1 per kit with positive-quantity components).
      (
        await db.$queryRaw<Row[]>(Prisma.sql`
          SELECT pc.kit_product_id AS product_id, p.sku, p.name,
                 CASE WHEN p.type = 'MANUFACTURED' THEN 'ASSEMBLED' ELSE 'PURCHASED' END AS supply_method,
                 COUNT(*) FILTER (WHERE pc.quantity > 0)::int AS lines
          FROM product_components pc JOIN products p ON p.id = pc.kit_product_id
          GROUP BY pc.kit_product_id, p.sku, p.name, p.type ORDER BY p.sku`)
      ).map((row) => ({
        productId: str(row.product_id),
        sku: str(row.sku),
        name: str(row.name),
        supplyMethod: str(row.supply_method),
        version: null,
        lines: num(row.lines),
        migrated: true,
      }));

  const barcodes = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT lower(btrim(barcode)) AS barcode, array_agg(sku ORDER BY sku) AS products
    FROM products
    WHERE barcode IS NOT NULL AND btrim(barcode) <> '' AND deleted_at IS NULL
    GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY 1`);

  const noCost = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT p.id, p.sku, p.name, p.owner_agent_id IS NOT NULL AS agent_owned,
           COALESCE(SUM(m.quantity), 0)::int AS on_hand, COUNT(*)::int AS movements
    FROM inventory_movements m JOIN products p ON p.id = m.product_id
    WHERE m.type NOT IN ${RESERVATIONS} AND p.current_cost IS NULL
    GROUP BY p.id, p.sku, p.name, p.owner_agent_id ORDER BY p.sku`);

  const investment = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT p.id, p.sku, p.name,
           array_remove(ARRAY[
             CASE WHEN p.owner_agent_id IS NOT NULL THEN 'AGENT_OWNED' END,
             CASE WHEN p.item_type = 'SERVICE' OR (p.item_type IS NULL AND p.type = 'SERVICE') THEN 'SERVICE' END,
             CASE WHEN NOT p.is_sellable THEN 'NOT_SELLABLE' END,
             CASE WHEN p.status <> 'ACTIVE' OR p.deleted_at IS NOT NULL THEN 'NOT_ACTIVE' END
           ], NULL) AS reasons,
           COALESCE((SELECT array_agg(io.code || ' (' || io.status::text || ')' ORDER BY io.code)
                     FROM opportunity_products op JOIN investment_opportunities io ON io.id = op.opportunity_id
                     WHERE op.product_id = p.id AND op.deleted_at IS NULL), ARRAY[]::text[]) AS opportunities
    FROM products p
    WHERE p.available_for_investment_opportunities
      AND (p.owner_agent_id IS NOT NULL OR p.item_type = 'SERVICE' OR (p.item_type IS NULL AND p.type = 'SERVICE')
           OR NOT p.is_sellable OR p.status <> 'ACTIVE' OR p.deleted_at IS NOT NULL)
    ORDER BY p.sku`);

  const agentGl = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT 'DIRECT' AS kind, j.entry_number, j.source_type, m.movement_number, p.sku
    FROM inventory_movements m JOIN products p ON p.id = m.product_id
    JOIN journal_entries j ON j.deleted_at IS NULL AND (
         (j.source_type = 'INVENTORY_ADJUSTMENT' AND j.source_id = m.id)
      OR (j.source_type = 'ASSEMBLY_ORDER' AND m.reference_type = 'ASSEMBLY_ORDER' AND j.source_id = m.reference_id))
    WHERE m.owner_agent_id IS NOT NULL
    UNION ALL
    SELECT 'DOCUMENT', j.entry_number, j.source_type, m.movement_number, p.sku
    FROM inventory_movements m JOIN products p ON p.id = m.product_id
    JOIN journal_entries j ON j.deleted_at IS NULL AND j.source_type = m.reference_type AND j.source_id = m.reference_id
    WHERE m.owner_agent_id IS NOT NULL
      AND m.reference_type IN ('SALES_INVOICE', 'PURCHASE_INVOICE', 'SALES_RETURN', 'PURCHASE_RETURN')`);

  return {
    productCounts: [...counts.values()].sort((a, b) => b.count - a.count),
    unclassifiedItemType: listing(
      live.filter((row) => row.item_type === null).map(ref),
    ),
    legacyTypeInconsistencies: listing(legacyType),
    attributeRuleViolations: listing(ruleViolations),
    assembledAndKits: listing(assembled),
    draftRecipesNeedingActivation: listing(drafts),
    barcodeDuplicates: listing(
      barcodes.map((row) => ({
        barcode: str(row.barcode),
        products: (row.products as string[]) ?? [],
      })),
    ),
    productsWithStockButNoCost: listing(
      noCost.map((row) => ({
        productId: str(row.id),
        sku: str(row.sku),
        name: str(row.name),
        onHand: num(row.on_hand),
        movements: num(row.movements),
        agentOwned: row.agent_owned === true,
      })),
    ),
    investmentEligibilityBlocked: listing(
      investment.map((row) => ({
        productId: str(row.id),
        sku: str(row.sku),
        name: str(row.name),
        reasons: (row.reasons as string[]) ?? [],
        opportunities: (row.opportunities as string[]) ?? [],
      })),
    ),
    agentOwnedWithCompanyGl: listing(
      agentGl.map((row) => ({
        kind: str(row.kind),
        entryNumber: str(row.entry_number),
        sourceType: str(row.source_type),
        movementNumber: str(row.movement_number),
        sku: str(row.sku),
      })),
    ),
  };
}

async function baseline(
  db: PrismaClient,
  r13: boolean,
): Promise<DryRunReport['baseline']> {
  const [products] = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT COUNT(*)::int AS count, COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted,
           md5(string_agg(concat_ws('|', id, sku, type::text, item_type::text, is_inventory_item, is_sellable,
                 is_purchasable, owner_agent_id, status::text, category_id, unit_id, barcode,
                 available_for_investment_opportunities, deleted_at IS NOT NULL), ',' ORDER BY id)) AS fingerprint
    FROM products`);
  const [movements] = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT COUNT(*)::int AS count,
           md5(string_agg(concat_ws('|', id, movement_number, type::text, product_id, warehouse_id, quantity,
                 quantity_before, quantity_after, round(unit_cost, 4), owner_agent_id, reference_type, reference_id,
                 created_at), ',' ORDER BY id)) AS fingerprint
    FROM inventory_movements`);
  const byType = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT type::text AS type, COUNT(*)::int AS n FROM inventory_movements GROUP BY 1 ORDER BY 1`);
  const balances = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT product_id, warehouse_id,
           COALESCE(SUM(quantity) FILTER (WHERE type NOT IN ${RESERVATIONS}), 0)::int AS on_hand,
           COALESCE(SUM(quantity) FILTER (WHERE type IN ${RESERVATIONS}), 0)::int AS reserved
    FROM inventory_movements GROUP BY 1, 2 ORDER BY 1, 2`);
  // Same formula as InventoryValuationService.getCompanyStockValue: company-owned, per product round2(onHand × average).
  const [stock] = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT COALESCE(SUM(round(x.on_hand * COALESCE(p.current_cost, 0), 2)), 0) AS value
    FROM (SELECT product_id, SUM(quantity) AS on_hand FROM inventory_movements
          WHERE owner_agent_id IS NULL AND type NOT IN ${RESERVATIONS} GROUP BY 1 HAVING SUM(quantity) <> 0) x
    JOIN products p ON p.id = x.product_id`);
  const [costs] = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT (SELECT COUNT(*)::int FROM products WHERE current_cost IS NOT NULL) AS with_cost,
           (SELECT md5(string_agg(concat_ws('|', id, round(current_cost, 4), last_cost_update), ',' ORDER BY id))
              FROM products) AS current_fp,
           (SELECT COUNT(*)::int FROM product_cost_snapshots) AS snapshots,
           (SELECT md5(string_agg(concat_ws('|', product_id, round(cost, 4)), ',' ORDER BY product_id))
              FROM product_cost_snapshots) AS snapshot_fp,
           (SELECT COUNT(*)::int FROM product_cost_histories) AS history,
           (SELECT md5(string_agg(concat_ws('|', id, product_id, round(previous_cost, 4), round(new_cost, 4)), ',' ORDER BY id))
              FROM product_cost_histories) AS history_fp,
           (SELECT md5(string_agg(concat_ws('|', id, round(unit_cost, 4), quantity), ',' ORDER BY id))
              FROM sales_invoice_items) AS invoice_line_fp`);
  const [gl] = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT (SELECT COUNT(*)::int FROM journal_entries) AS entries,
           COUNT(*)::int AS lines, COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit,
           md5(string_agg(concat_ws('|', jl.id, jl.journal_entry_id, jl.account_id, jl.debit, jl.credit), ',' ORDER BY jl.id))
             AS fingerprint
    FROM journal_entry_lines jl`);
  const inventoryAccounts = await db.$queryRaw<Row[]>(Prisma.sql`
    WITH ids AS (
      SELECT inventory_account_id AS id FROM posting_settings WHERE inventory_account_id IS NOT NULL
      UNION SELECT inventory_account_id FROM product_categories WHERE inventory_account_id IS NOT NULL
    )
    SELECT a.id, a.code, a.name,
           COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE j.id IS NOT NULL), 0) AS balance
    FROM ids JOIN chart_of_accounts a ON a.id = ids.id
    LEFT JOIN journal_entry_lines jl ON jl.account_id = a.id
    LEFT JOIN journal_entries j ON j.id = jl.journal_entry_id AND j.deleted_at IS NULL
      AND j.status IN ('POSTED', 'REVERSED')
    GROUP BY a.id, a.code, a.name ORDER BY a.code`);
  const [cogs] = await db.$queryRaw<Row[]>(Prisma.sql`
    WITH ids AS (
      SELECT cogs_account_id AS id FROM posting_settings WHERE cogs_account_id IS NOT NULL
      UNION SELECT cogs_account_id FROM product_categories WHERE cogs_account_id IS NOT NULL
    )
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS balance
    FROM journal_entry_lines jl JOIN journal_entries j ON j.id = jl.journal_entry_id
    WHERE jl.account_id IN (SELECT id FROM ids) AND j.deleted_at IS NULL AND j.status IN ('POSTED', 'REVERSED')`);
  const [delivery] = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT (SELECT COALESCE(SUM(abs(quantity) * COALESCE(unit_cost, 0)), 0) FROM inventory_movements
              WHERE type = 'SALES_DELIVERY') AS movement_value,
           (SELECT COALESCE(SUM(round(si.unit_cost * si.quantity, 2)), 0)
              FROM sales_invoice_items si JOIN sales_invoices i ON i.id = si.sales_invoice_id
              WHERE i.status NOT IN ('DRAFT', 'CANCELLED') AND si.unit_cost IS NOT NULL) AS invoice_cogs`);
  const [components] = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT COUNT(*)::int AS count,
           md5(string_agg(concat_ws('|', id, kit_product_id, component_product_id, quantity), ',' ORDER BY id)) AS fingerprint
    FROM product_components`);
  const recipes = r13
    ? await db.$queryRaw<Row[]>(Prisma.sql`
        SELECT status::text AS status, COUNT(*)::int AS n FROM product_recipes GROUP BY 1`)
    : [];

  return {
    products: {
      count: num(products?.count),
      deleted: num(products?.deleted),
      attributeFingerprint: str(products?.fingerprint),
    },
    movements: {
      count: num(movements?.count),
      byType: Object.fromEntries(
        byType.map((row) => [str(row.type), num(row.n)]),
      ),
      fingerprint: str(movements?.fingerprint),
    },
    onHand: Object.fromEntries(
      balances.map((row) => [
        `${str(row.product_id)}|${str(row.warehouse_id)}`,
        `${num(row.on_hand)}/${num(row.reserved)}`,
      ]),
    ),
    onHandUnits: balances.reduce((sum, row) => sum + num(row.on_hand), 0),
    companyStockValue: money(stock?.value),
    costs: {
      productsWithCost: num(costs?.with_cost),
      currentCostFingerprint: str(costs?.current_fp),
      snapshots: num(costs?.snapshots),
      snapshotFingerprint: str(costs?.snapshot_fp),
      history: num(costs?.history),
      historyFingerprint: str(costs?.history_fp),
      invoiceLineCostFingerprint: str(costs?.invoice_line_fp),
    },
    gl: {
      entries: num(gl?.entries),
      lines: num(gl?.lines),
      totalDebit: money(gl?.debit),
      totalCredit: money(gl?.credit),
      linesFingerprint: str(gl?.fingerprint),
      inventoryAccounts: inventoryAccounts.map((row) => ({
        id: str(row.id),
        code: str(row.code),
        name: str(row.name),
        balance: money(row.balance),
      })),
      cogsBalance: money(cogs?.balance),
    },
    salesDeliveryCogs: {
      movementValue: money(delivery?.movement_value),
      invoiceLineCogs: money(delivery?.invoice_cogs),
    },
    legacyComponents: {
      count: num(components?.count),
      fingerprint: str(components?.fingerprint),
    },
    recipes: {
      count: recipes.reduce((sum, row) => sum + num(row.n), 0),
      byStatus: Object.fromEntries(
        recipes.map((row) => [str(row.status), num(row.n)]),
      ),
    },
  };
}

function markdown(report: DryRunReport): string {
  const r = report.review;
  const b = report.baseline;
  const lines = [
    `# R13 migration dry run — database "${report.meta.database}"`,
    '',
    `Generated ${report.meta.generatedAt}. Last migration: \`${report.meta.lastMigration ?? '—'}\`. ` +
      `R13 applied: **${report.meta.r13Applied ? 'yes' : 'no'}** (supply method ${report.meta.supplyMethodSource === 'COLUMN' ? 'as stored' : 'as the migration WILL set it'}).`,
    '',
    '## Owner review',
    '',
    '| Item | Count |',
    '| --- | ---: |',
    `| Products without item type (UNCLASSIFIED) | ${r.unclassifiedItemType.count} |`,
    `| Stored legacy type ≠ type derived from attributes | ${r.legacyTypeInconsistencies.count} |`,
    `| Attribute rule violations (service stocked, stocked kit, unstocked assembled) | ${r.attributeRuleViolations.count} |`,
    `| Assembled / kit / MANUFACTURED products | ${r.assembledAndKits.count} |`,
    `| DRAFT recipes needing review + activation | ${r.draftRecipesNeedingActivation.count} |`,
    `| Duplicate barcodes (non-deleted) | ${r.barcodeDuplicates.count} |`,
    `| Products with stock movements but no cost | ${r.productsWithStockButNoCost.count} |`,
    `| Investment-eligible products the new rule would block (grandfathered) | ${r.investmentEligibilityBlocked.count} |`,
    `| Agent-owned stock referenced by company journals | ${r.agentOwnedWithCompanyGl.count} |`,
    '',
    '### Product classification',
    '',
    '| Item type | Supply | Tracked | Sell | Buy | Agent | Legacy type | Deleted | Count |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | ---: |',
    ...r.productCounts.map(
      (row) =>
        `| ${row.itemType ?? 'UNCLASSIFIED'} | ${row.supplyMethod} | ${yn(row.isInventoryItem)} | ${yn(row.isSellable)} | ${yn(row.isPurchasable)} | ${yn(row.agentOwned)} | ${row.legacyType} | ${yn(row.deleted)} | ${row.count} |`,
    ),
  ];
  const sample = <T>(title: string, rows: T[], format: (row: T) => string) => {
    if (rows.length === 0) return;
    lines.push('', `### ${title}`, '');
    for (const row of rows.slice(0, 15)) lines.push(`- ${format(row)}`);
    if (rows.length > 15)
      lines.push(`- … ${rows.length - 15} more in the JSON`);
  };
  sample(
    'Legacy type inconsistencies',
    r.legacyTypeInconsistencies.rows,
    (row) =>
      `${row.sku} ${row.name}: stored ${row.type}, derived ${row.derivedType} (${row.itemType}, ${row.supplyMethod}, track ${yn(row.isInventoryItem)}, sell ${yn(row.isSellable)}, buy ${yn(row.isPurchasable)})`,
  );
  sample(
    'Attribute rule violations',
    r.attributeRuleViolations.rows,
    (row) => `${row.sku} ${row.name}: ${row.code}`,
  );
  sample(
    'Assembled / kit products',
    r.assembledAndKits.rows,
    (row) =>
      `${row.sku} ${row.name}: ${row.supplyMethod}, legacy components ${row.legacyComponents}, recipes ${JSON.stringify(row.recipes)}`,
  );
  sample(
    'DRAFT recipes',
    r.draftRecipesNeedingActivation.rows,
    (row) =>
      `${row.sku} ${row.name}: v${row.version ?? 1}, ${row.lines} line(s)${row.migrated ? ', migrated' : ''}`,
  );
  sample(
    'Duplicate barcodes',
    r.barcodeDuplicates.rows,
    (row) => `${row.barcode}: ${row.products.join(', ')}`,
  );
  sample(
    'Stock without cost',
    r.productsWithStockButNoCost.rows,
    (row) =>
      `${row.sku} ${row.name}: on-hand ${row.onHand}, ${row.movements} movement(s)${row.agentOwned ? ', agent-owned' : ''}`,
  );
  sample(
    'Investment eligibility the new rule blocks',
    r.investmentEligibilityBlocked.rows,
    (row) =>
      `${row.sku} ${row.name}: ${row.reasons.join(', ')}; opportunities ${row.opportunities.join(', ') || 'none'}`,
  );
  sample(
    'Agent stock with company journals',
    r.agentOwnedWithCompanyGl.rows,
    (row) =>
      `${row.kind}: ${row.entryNumber} (${row.sourceType}) ← ${row.movementNumber} ${row.sku}`,
  );
  lines.push(
    '',
    '## Reconciliation baseline',
    '',
    '| Figure | Value |',
    '| --- | ---: |',
    `| Products (deleted) | ${b.products.count} (${b.products.deleted}) |`,
    `| Movements | ${b.movements.count} |`,
    `| Product × warehouse balances | ${Object.keys(b.onHand).length} |`,
    `| Σ on-hand units | ${b.onHandUnits} |`,
    `| Company stock value (Σ round2(onHand × average)) | ${b.companyStockValue} |`,
    `| Products with a cost | ${b.costs.productsWithCost} |`,
    `| Cost snapshots / history rows | ${b.costs.snapshots} / ${b.costs.history} |`,
    `| Journal entries / lines | ${b.gl.entries} / ${b.gl.lines} |`,
    `| Σ debit = Σ credit | ${b.gl.totalDebit} / ${b.gl.totalCredit} |`,
    `| GL inventory accounts (posted balance) | ${b.gl.inventoryAccounts.map((a) => `${a.code} ${a.balance}`).join('; ')} |`,
    `| GL COGS accounts (posted balance) | ${b.gl.cogsBalance} |`,
    `| SALES_DELIVERY value (Σ abs(qty) × movement cost) | ${b.salesDeliveryCogs.movementValue} |`,
    `| Invoice line COGS (Σ round2(unitCost × qty)) | ${b.salesDeliveryCogs.invoiceLineCogs} |`,
    `| Legacy product_components rows | ${b.legacyComponents.count} |`,
    `| Recipes | ${b.recipes.count} ${JSON.stringify(b.recipes.byStatus)} |`,
  );
  return `${lines.join('\n')}\n`;
}

const yn = (value: boolean) => (value ? 'yes' : 'no');

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
  const db = readOnlyClient(url!);
  try {
    const r13 = await exists(db, 'products', 'supply_method');
    const migrations = (await exists(db, '_prisma_migrations'))
      ? await db.$queryRaw<Row[]>(Prisma.sql`
          SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL
          ORDER BY migration_name DESC LIMIT 1`)
      : [];
    const report: DryRunReport = {
      meta: {
        database: target.database,
        host: target.host,
        generatedAt: new Date().toISOString(),
        lastMigration: migrations[0] ? str(migrations[0].migration_name) : null,
        r13Applied: r13,
        supplyMethodSource: r13 ? 'COLUMN' : 'PROJECTED',
      },
      review: await review(db, r13),
      baseline: await baseline(db, r13),
    };
    const json = `${JSON.stringify(report, null, 2)}\n`;
    const jsonOut = arg('json');
    if (jsonOut) process.stderr.write(`json → ${write(jsonOut, json)}\n`);
    const out = arg('out');
    if (out)
      process.stderr.write(`markdown → ${write(out, markdown(report))}\n`);
    if (!jsonOut && !flag('quiet')) process.stdout.write(json);
    process.stderr.write(
      `${target.database}: products ${report.baseline.products.count}, movements ${report.baseline.movements.count}, ` +
        `unclassified ${report.review.unclassifiedItemType.count}, drafts ${report.review.draftRecipesNeedingActivation.count}\n`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
});
