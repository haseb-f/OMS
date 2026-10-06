/**
 * R13 — read-only proof of the Production test-data reset
 * (migration 20261006160000_r13_reset_production_test_data, plan: specs/product-inventory-costing/reset-plan.md).
 *
 *   # 1) before the release — snapshot (counts + id fingerprints of every table)
 *   DATABASE_URL=postgresql://oms:oms@localhost:5434/oms_reset_rehearsal \
 *     pnpm --dir apps/api exec ts-node scripts/r13/r13-reset-verify.ts --snapshot=../../tmp/reset/before.json
 *
 *   # 2) after the reset — invariants + comparison with the snapshot (exit 1 on any FAIL)
 *     ... r13-reset-verify.ts --expect=reset --before=../../tmp/reset/before.json \
 *           --out=../../specs/product-inventory-costing/evidence/reset-verify.md [--json=<file>] [--snapshot=<after.json>]
 *
 *   # guard proof — the migration must not have changed anything on a non-Production database
 *     ... r13-reset-verify.ts --expect=unchanged --before=<snapshot.json>
 *
 * READ-ONLY session (default_transaction_read_only); refuses the local main database "oms"; a non-local host
 * needs --allow-remote (owner-run, read-only). Every public table must be classified below, or the run FAILs.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type { PrismaClient } from '@prisma/client';
import {
  arg,
  assertAllowedDatabase,
  flag,
  readOnlyClient,
} from './read-only-db';

/** Master data, configuration, security — rows must be identical after the reset. */
export const KEEP = [
  '_ClassificationSuggestedReasons',
  'accounting_periods',
  'agent_agreements',
  'agent_payment_destinations',
  'agent_product_commission_overrides',
  'agent_shipping_rates',
  'agents',
  'analytic_accounts',
  'analytic_plans',
  'branches',
  'chart_of_accounts',
  'cities',
  'commission_plan_assignments',
  'commission_plan_tiers',
  'commission_plans',
  'companies',
  'company_memberships',
  'compensation_revision_lines',
  'compensation_revisions',
  'cost_allocation_rules',
  'cost_centers',
  'cost_component_activities',
  'cost_components',
  'countries',
  'currencies',
  'customer_classifications',
  'customer_groups',
  'customer_profiles',
  'departments',
  'direct_fulfillment_cost_rules',
  'employee_profiles',
  'exchange_rate_overrides',
  'exchange_rates',
  'fiscal_years',
  'fx_sync_runs',
  'fx_sync_settings',
  'global_lookup_audits',
  'import_mapping_templates',
  'inventory_settings',
  'investor_portal_accounts',
  'investor_portal_activation_tokens',
  'investor_profiles',
  'investor_types',
  'job_titles',
  'journal_entry_templates',
  'journals',
  'kpi_template_assignments',
  'kpi_template_items',
  'kpi_templates',
  'languages',
  'lead_distribution_policies',
  'lead_distribution_states',
  'lead_follow_up_types',
  'no_purchase_reasons',
  'number_series',
  'partner_phone_keys',
  'partner_role_assignments',
  'partners',
  'password_reset_tokens',
  'payment_methods',
  'payment_sources',
  'payment_terms',
  'payroll_components',
  'permissions',
  'posting_settings',
  'product_activities',
  'product_attachments',
  'product_brands',
  'product_categories',
  'product_components',
  'product_recipe_lines',
  'product_recipes',
  'product_variants',
  'projects',
  'receiving_accounts',
  'sales_targets',
  'sales_team_members',
  'sales_teams',
  'shipping_companies',
  'shipping_methods',
  'shipping_statuses',
  'status_definitions',
  'supplier_groups',
  'supplier_profiles',
  'taxes',
  'transaction_types',
  'unit_conversions',
  'units',
  'user_permissions',
  'users',
  'warehouse_locations',
  'warehouses',
  'workflow_transitions',
] as const;

/** Kept rows whose derived fields are cleared (row set identical). */
export const RESET_FIELD = {
  products:
    'current_cost, last_cost_update → NULL (derived from the deleted cost history)',
  sync_source_configs:
    'import_job_id → NULL ("latest sync run" pointer to a deleted import job)',
} as const;

/** Kept by default, deleted when the owner switch says so (identical OR empty afterwards). */
export const CONDITIONAL = {
  leads: 'R-O3',
  lead_activities: 'R-O3',
  lead_assignments: 'R-O3',
  lead_follow_ups: 'R-O3',
  lead_notes: 'R-O3',
  lead_views: 'R-O3',
  status_history: 'R-O3 (LEAD rows)',
  workflow_approvals: 'R-O3 (LEAD rows)',
  investment_opportunities: 'R-O2',
  opportunity_products: 'R-O2',
} as const;

/** Partly kept. */
export const PARTIAL = {
  journal_entries: 'only Opening Balance entries (+ their reversals) — R-O1',
  journal_entry_lines: 'lines of the kept entries',
  journal_entry_activities: 'activities of the kept entries',
  attachments: 'only file records still referenced by a kept row',
  master_data_activity_logs:
    'rows of deleted entities removed; master-data history kept',
} as const;

/** Transactional test data — empty afterwards. */
export const DELETE = [
  'accrued_expenses',
  'agent_commission_lines',
  'agent_ledger_entries',
  'agent_order_returns',
  'agent_payout_allocations',
  'agent_payout_attachments',
  'agent_payouts',
  'analytic_distribution_lines',
  'assembly_order_lines',
  'assembly_orders',
  'bank_transactions',
  'capital_contribution_attachments',
  'capital_contributions',
  'capital_returns',
  'carrier_charge_imports',
  'carrier_charges',
  'commission_adjustments',
  'commission_calculations',
  'cost_allocation_results',
  'cost_allocation_runs',
  'distribution_payment_attachments',
  'distribution_payments',
  'expenses',
  'financial_transaction_activities',
  'financial_transaction_allocations',
  'financial_transactions',
  'fixed_asset_depreciation_periods',
  'fixed_assets',
  'fx_revaluation_runs',
  'import_job_errors',
  'import_jobs',
  'inventory_movement_activities',
  'inventory_movements',
  'investor_distributions',
  'investor_ledger_entries',
  'investor_subscriptions',
  'kpi_evaluation_audit_logs',
  'kpi_evaluation_items',
  'kpi_evaluations',
  'landed_cost_activities',
  'landed_cost_allocations',
  'landed_cost_documents',
  'landed_cost_lines',
  'opportunity_expense_attachments',
  'opportunity_expenses',
  'opportunity_reallocations',
  'opportunity_sale_allocations',
  'opportunity_settlements',
  'order_items',
  'payment_activities',
  'payment_attachments',
  'payment_matches',
  'payment_notes',
  'payment_receipt_links',
  'payment_settlement_lines',
  'payment_settlements',
  'payment_statement_imports',
  'payment_statement_lines',
  'payments',
  'payroll_line_components',
  'payroll_lines',
  'payroll_runs',
  'physical_count_lines',
  'physical_counts',
  'prepaid_expenses',
  'prepaid_recognitions',
  'product_cost_histories',
  'product_cost_snapshots',
  'profit_calculation_investor_shares',
  'profit_calculations',
  'profit_distributions',
  'purchase_invoice_activities',
  'purchase_invoice_items',
  'purchase_invoices',
  'purchase_order_activities',
  'purchase_order_items',
  'purchase_orders',
  'purchase_quotation_activities',
  'purchase_quotation_items',
  'purchase_quotations',
  'purchase_return_activities',
  'purchase_return_items',
  'purchase_returns',
  'sales_invoice_activities',
  'sales_invoice_items',
  'sales_invoices',
  'sales_order_activities',
  'sales_order_attachments',
  'sales_order_document_activities',
  'sales_order_document_items',
  'sales_order_documents',
  'sales_order_notes',
  'sales_order_status_history',
  'sales_orders',
  'sales_quotation_activities',
  'sales_quotation_items',
  'sales_quotations',
  'sales_return_activities',
  'sales_return_items',
  'sales_returns',
  'shipment_attachments',
  'shipments',
  'store_order_activities',
  'store_order_amendments',
  'store_order_fulfillment_costs',
  'store_order_items',
  'store_order_receipts',
  'store_orders',
] as const;

/** Bookkeeping / append-by-the-system tables: may only grow between the snapshot and the check. */
const GROWS = new Set([
  '_prisma_migrations',
  'fx_sync_runs',
  'exchange_rates',
  'global_lookup_audits',
  'password_reset_tokens',
]);

interface Snapshot {
  database: string;
  host: string;
  at: string;
  tables: Record<string, { count: number; fingerprint: string | null }>;
  numberSeries: Record<string, number>;
  journalEntries: {
    entryNumber: string;
    sourceType: string | null;
    status: string;
    totalDebit: string;
  }[];
  fiscalYears: {
    name: string;
    status: string;
    startDate: string;
    endDate: string;
    openingEntries: number;
  }[];
  periodsByStatus: Record<string, number>;
  productsWithCost: number;
  syncSources: { total: number; enabled: number; withJobPointer: number };
  leadTimelineOrphans: number;
}

type Status = 'PASS' | 'WARN' | 'FAIL';
interface Check {
  status: Status;
  name: string;
  detail: string;
}

const q = <T>(db: PrismaClient, sql: string) => db.$queryRawUnsafe<T[]>(sql);
const ident = (t: string) => `"${t.replace(/"/g, '""')}"`;

async function snapshot(
  db: PrismaClient,
  database: string,
  host: string,
): Promise<Snapshot> {
  const tables = await q<{ t: string; has_id: boolean }>(
    db,
    `SELECT c.relname AS t,
            EXISTS (SELECT 1 FROM information_schema.columns k
                    WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'id') AS has_id
       FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
      WHERE s.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`,
  );
  const out: Snapshot['tables'] = {};
  for (const { t, has_id } of tables) {
    const [row] = await q<{ n: bigint; f: string | null }>(
      db,
      `SELECT count(*) AS n, ${has_id ? `md5(string_agg(id::text, ',' ORDER BY id::text))` : 'NULL'} AS f FROM ${ident(t)}`,
    );
    out[t] = { count: Number(row.n), fingerprint: row.f };
  }
  const ns = await q<{ d: string; n: number }>(
    db,
    `SELECT document_type AS d, next_number AS n FROM number_series ORDER BY 1`,
  );
  const je = await q<{ e: string; s: string | null; st: string; d: string }>(
    db,
    `SELECT entry_number AS e, source_type AS s, status::text AS st, total_debit::text AS d
       FROM journal_entries WHERE source_type = 'OPENING_BALANCE'
          OR reversal_of_entry_id IN (SELECT id FROM journal_entries WHERE source_type = 'OPENING_BALANCE')
      ORDER BY entry_number`,
  );
  const fy = await q<{
    name: string;
    status: string;
    s: string;
    e: string;
    o: bigint;
  }>(
    db,
    `SELECT f.name, f.status::text AS status, f.start_date::date::text AS s, f.end_date::date::text AS e,
            (SELECT count(*) FROM journal_entries j WHERE j.source_type = 'OPENING_BALANCE' AND j.source_id = f.id AND j.deleted_at IS NULL) AS o
       FROM fiscal_years f WHERE f.deleted_at IS NULL ORDER BY f.start_date`,
  );
  const periods = await q<{ s: string; n: bigint }>(
    db,
    `SELECT status::text AS s, count(*) AS n FROM accounting_periods GROUP BY 1`,
  );
  const [cost] = await q<{ n: bigint }>(
    db,
    `SELECT count(*) AS n FROM products WHERE current_cost IS NOT NULL OR last_cost_update IS NOT NULL`,
  );
  const [sync] = await q<{ t: bigint; e: bigint; j: bigint }>(
    db,
    `SELECT count(*) AS t, count(*) FILTER (WHERE enabled AND deleted_at IS NULL) AS e,
            count(*) FILTER (WHERE import_job_id IS NOT NULL) AS j FROM sync_source_configs`,
  );
  const [orphans] = await q<{ n: bigint }>(
    db,
    `SELECT (SELECT count(*) FROM status_history h WHERE NOT EXISTS (SELECT 1 FROM leads e WHERE e.id = h.entity_id))
          + (SELECT count(*) FROM workflow_approvals w WHERE NOT EXISTS (SELECT 1 FROM leads e WHERE e.id = w.entity_id)) AS n`,
  );
  return {
    database,
    host,
    at: new Date().toISOString(),
    tables: out,
    numberSeries: Object.fromEntries(ns.map((r) => [r.d, Number(r.n)])),
    journalEntries: je.map((r) => ({
      entryNumber: r.e,
      sourceType: r.s,
      status: r.st,
      totalDebit: r.d,
    })),
    fiscalYears: fy.map((r) => ({
      name: r.name,
      status: r.status,
      startDate: r.s,
      endDate: r.e,
      openingEntries: Number(r.o),
    })),
    periodsByStatus: Object.fromEntries(periods.map((r) => [r.s, Number(r.n)])),
    productsWithCost: Number(cost.n),
    syncSources: {
      total: Number(sync.t),
      enabled: Number(sync.e),
      withJobPointer: Number(sync.j),
    },
    leadTimelineOrphans: Number(orphans.n),
  };
}

function classify(table: string): string | null {
  if ((KEEP as readonly string[]).includes(table)) return 'KEEP';
  if (table in RESET_FIELD) return 'RESET-FIELD';
  if (table in CONDITIONAL) return 'CONDITIONAL';
  if (table in PARTIAL) return 'PARTIAL';
  if ((DELETE as readonly string[]).includes(table)) return 'DELETE';
  if (table === '_prisma_migrations') return 'KEEP';
  return null;
}

async function resetInvariants(
  db: PrismaClient,
  now: Snapshot,
): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (status: Status, name: string, detail: string) =>
    checks.push({ status, name, detail });
  const one = async (sql: string) =>
    Number((await q<{ n: bigint }>(db, sql))[0].n);

  const unclassified = Object.keys(now.tables).filter((t) => !classify(t));
  add(
    unclassified.length ? 'FAIL' : 'PASS',
    'every table classified',
    unclassified.join(', ') || `${Object.keys(now.tables).length} tables`,
  );

  const notEmpty = DELETE.filter(
    (t) => now.tables[t] && now.tables[t].count > 0,
  ).map((t) => `${t}=${now.tables[t].count}`);
  add(
    notEmpty.length ? 'FAIL' : 'PASS',
    'DELETE tables empty',
    notEmpty.join(', ') || `${DELETE.length} tables at 0`,
  );

  const foreignJe = await one(
    `SELECT count(*) AS n FROM journal_entries WHERE source_type IS DISTINCT FROM 'OPENING_BALANCE'
        AND (reversal_of_entry_id IS NULL OR reversal_of_entry_id NOT IN (SELECT id FROM journal_entries WHERE source_type = 'OPENING_BALANCE'))`,
  );
  add(
    foreignJe ? 'FAIL' : 'PASS',
    'journal entries = opening balance (+ reversal) only',
    `${foreignJe} other entries; kept: ${now.journalEntries.map((j) => `${j.entryNumber} ${j.sourceType} ${j.status} ${j.totalDebit}`).join('; ') || 'none'}`,
  );

  const unbalanced = await one(
    `SELECT count(*) AS n FROM (SELECT j.id FROM journal_entries j JOIN journal_entry_lines l ON l.journal_entry_id = j.id
        GROUP BY j.id HAVING sum(l.debit) <> sum(l.credit)) x`,
  );
  const [tb] = await q<{ d: string; c: string }>(
    db,
    `SELECT coalesce(sum(debit),0)::text AS d, coalesce(sum(credit),0)::text AS c FROM journal_entry_lines`,
  );
  add(
    unbalanced || tb.d !== tb.c ? 'FAIL' : 'PASS',
    'trial balance balanced',
    `debit ${tb.d} = credit ${tb.c}; unbalanced entries ${unbalanced}`,
  );

  add(
    now.productsWithCost ? 'FAIL' : 'PASS',
    'product current cost cleared',
    `${now.productsWithCost} products still carry a cost`,
  );

  const orphanAttachments = await one(
    `SELECT count(*) AS n FROM attachments a WHERE NOT EXISTS (SELECT 1 FROM payment_attachments x WHERE x.attachment_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM shipment_attachments x WHERE x.attachment_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM store_order_receipts x WHERE x.attachment_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM agent_payout_attachments x WHERE x.attachment_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM capital_contribution_attachments x WHERE x.attachment_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM distribution_payment_attachments x WHERE x.attachment_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM opportunity_expense_attachments x WHERE x.attachment_id = a.id)`,
  );
  add(
    orphanAttachments ? 'FAIL' : 'PASS',
    'no unreferenced attachment records',
    `${orphanAttachments}`,
  );

  const orphanLogs = await one(
    `SELECT count(*) AS n FROM master_data_activity_logs l WHERE l.entity_type IN
       ('CAPITAL_CONTRIBUTION','CAPITAL_RETURN','CARRIER_CHARGE','DISTRIBUTION_PAYMENT','EXPENSE','FIXED_ASSET',
        'INVESTOR_SUBSCRIPTION','OPPORTUNITY_EXPENSE','OPPORTUNITY_REALLOCATION','OPPORTUNITY_SALE_ALLOCATION',
        'OPPORTUNITY_SETTLEMENT','PROFIT_CALCULATION','PROFIT_DISTRIBUTION')
       OR (l.entity_type = 'INVESTMENT_OPPORTUNITY' AND NOT EXISTS (SELECT 1 FROM investment_opportunities e WHERE e.id = l.entity_id))
       OR (l.entity_type = 'LEAD' AND NOT EXISTS (SELECT 1 FROM leads e WHERE e.id = l.entity_id))`,
  );
  add(
    orphanLogs ? 'FAIL' : 'PASS',
    'no activity-log rows of deleted entities',
    `${orphanLogs}`,
  );

  // Lead status history / approvals whose lead is gone. Pre-existing orphans (hard-deleted QA leads) are only
  // reported; the reset itself must not add any (checked against the snapshot in compare()).
  add(
    now.leadTimelineOrphans ? 'WARN' : 'PASS',
    'lead timeline consistent with leads',
    `${now.leadTimelineOrphans} orphan rows${now.leadTimelineOrphans ? ' (see before/after comparison)' : ''}`,
  );

  if (now.tables.investment_opportunities?.count) {
    add(
      'WARN',
      'investment opportunities kept (R-O2 = keep)',
      `${now.tables.investment_opportunities.count} opportunities with 0 subscriptions — review statuses`,
    );
  }

  add(
    now.syncSources.withJobPointer ? 'FAIL' : 'PASS',
    'sync sources point at no deleted import job',
    `${now.syncSources.withJobPointer}`,
  );

  const triggers = await q<{ t: string; e: string }>(
    db,
    `SELECT tgname AS t, tgenabled::text AS e FROM pg_trigger WHERE tgname IN ('agent_ledger_entries_guard_trg','agent_commission_lines_guard_trg','agent_ledger_entries_no_truncate_trg')`,
  );
  const off = triggers.filter((t) => t.e !== 'O');
  add(
    off.length || triggers.length !== 3 ? 'FAIL' : 'PASS',
    'agent append-only guard triggers enabled',
    triggers.map((t) => `${t.t}=${t.e}`).join(', '),
  );

  // Posting must stay possible: every open fiscal year needs an established opening (FiscalYearsService.assertPostingAllowed).
  for (const fy of now.fiscalYears) {
    if (fy.status === 'CLOSED') {
      add(
        'WARN',
        `fiscal year ${fy.name} is CLOSED`,
        'no posting possible inside it',
      );
    } else if (!fy.openingEntries) {
      add(
        'WARN',
        `fiscal year ${fy.name} has no Opening Balance entry`,
        'every posting dated inside it is refused until the owner posts the opening (Accounting → Opening Balances)',
      );
    } else {
      add(
        'PASS',
        `fiscal year ${fy.name} keeps its opening`,
        `${fy.openingEntries} opening entr${fy.openingEntries === 1 ? 'y' : 'ies'}`,
      );
    }
  }
  if (now.periodsByStatus.CLOSED || now.periodsByStatus.LOCKED) {
    add(
      'WARN',
      'closed / locked accounting periods',
      JSON.stringify(now.periodsByStatus),
    );
  }
  return checks;
}

function compare(before: Snapshot, now: Snapshot, expect: string): Check[] {
  const checks: Check[] = [];
  const add = (status: Status, name: string, detail: string) =>
    checks.push({ status, name, detail });
  const tables = [
    ...new Set([...Object.keys(before.tables), ...Object.keys(now.tables)]),
  ].sort();
  const diffs: string[] = [];
  for (const t of tables) {
    const b = before.tables[t];
    const a = now.tables[t];
    if (!b || !a) {
      diffs.push(`${t}: ${b ? 'missing after' : 'new table'}`);
      continue;
    }
    const identical = b.count === a.count && b.fingerprint === a.fingerprint;
    if (expect === 'unchanged') {
      if (!identical && !GROWS.has(t))
        diffs.push(`${t}: ${b.count} → ${a.count}`);
      continue;
    }
    const kind = classify(t);
    if (GROWS.has(t)) {
      if (a.count < b.count) diffs.push(`${t}: shrank ${b.count} → ${a.count}`);
    } else if (kind === 'KEEP' || kind === 'RESET-FIELD') {
      if (!identical)
        diffs.push(
          `${t}: ${b.count} → ${a.count}${b.count === a.count ? ' (ids differ)' : ''}`,
        );
    } else if (kind === 'CONDITIONAL') {
      if (!identical && a.count !== 0)
        diffs.push(`${t}: ${b.count} → ${a.count} (neither kept nor reset)`);
    } else if (kind === 'PARTIAL') {
      if (a.count > b.count) diffs.push(`${t}: grew ${b.count} → ${a.count}`);
    }
  }
  if (expect === 'unchanged') {
    add(
      diffs.length ? 'FAIL' : 'PASS',
      'every table identical to the snapshot (guard = no-op)',
      diffs.join('; ') || `${tables.length} tables identical`,
    );
  } else {
    add(
      diffs.length ? 'FAIL' : 'PASS',
      'master / configuration rows identical to the snapshot',
      diffs.join('; ') ||
        'KEEP + RESET-FIELD tables identical (counts and id fingerprints)',
    );
  }
  if (expect === 'reset') {
    const grew = now.leadTimelineOrphans > (before.leadTimelineOrphans ?? 0);
    add(
      grew ? 'FAIL' : 'PASS',
      'reset added no lead-timeline orphans',
      `${before.leadTimelineOrphans ?? '?'} before → ${now.leadTimelineOrphans} after`,
    );
  }
  const ns =
    JSON.stringify(before.numberSeries) === JSON.stringify(now.numberSeries);
  add(
    ns ? 'PASS' : 'FAIL',
    'number series counters unchanged (no number reuse)',
    ns ? `${Object.keys(now.numberSeries).length} series` : 'counters differ',
  );
  return checks;
}

function markdown(
  now: Snapshot,
  before: Snapshot | null,
  checks: Check[],
): string {
  const overall = checks.some((c) => c.status === 'FAIL')
    ? 'FAIL'
    : checks.some((c) => c.status === 'WARN')
      ? 'WARN'
      : 'PASS';
  const lines = [
    `# R13 reset verification — database "${now.database}"`,
    '',
    `${now.at} · overall **${overall}**`,
    '',
    '| Check | Status | Detail |',
    '| --- | --- | --- |',
    ...checks.map(
      (c) => `| ${c.name} | ${c.status} | ${c.detail.replace(/\|/g, '/')} |`,
    ),
    '',
    '## Row counts',
    '',
    `| Table | Class | ${before ? 'Before | ' : ''}After |`,
    `| --- | --- | ${before ? '---: | ' : ''}---: |`,
  ];
  for (const t of Object.keys(now.tables).sort()) {
    const b = before?.tables[t]?.count;
    lines.push(
      `| ${t} | ${classify(t) ?? '??'} | ${before ? `${b ?? '–'} | ` : ''}${now.tables[t].count} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

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
    const now = await snapshot(db, target.database, target.host);
    const snapOut = arg('snapshot');
    if (snapOut)
      process.stderr.write(
        `snapshot → ${write(snapOut, `${JSON.stringify(now, null, 2)}\n`)}\n`,
      );

    const expect = arg('expect');
    const beforePath = arg('before');
    const before = beforePath
      ? (JSON.parse(readFileSync(resolve(beforePath), 'utf8')) as Snapshot)
      : null;
    const checks: Check[] = [];
    if (expect === 'reset') checks.push(...(await resetInvariants(db, now)));
    if (before && expect) checks.push(...compare(before, now, expect));

    for (const c of checks)
      process.stdout.write(`${c.status.padEnd(4)}  ${c.name} — ${c.detail}\n`);
    const out = arg('out');
    if (out)
      process.stderr.write(
        `markdown → ${write(out, markdown(now, before, checks))}\n`,
      );
    const json = arg('json');
    if (json)
      process.stderr.write(
        `json → ${write(json, `${JSON.stringify({ snapshot: now, checks }, null, 2)}\n`)}\n`,
      );
    if (checks.some((c) => c.status === 'FAIL')) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
