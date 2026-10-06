-- R13 — one-time reset of Production TEST transactional data (owner decision 2026-10-06).
--
-- Plan, table classification, rehearsal evidence, backup/restore and the owner switches:
--   specs/product-inventory-costing/reset-plan.md
-- Read-only before/after check: apps/api/scripts/r13/r13-reset-verify.ts
--
-- Production's transactional data (2026-09-17 … 2026-10-05) is QA test data. This migration deletes every
-- document, stock movement, journal entry, payment and order and KEEPS all master data, configuration, users,
-- permissions and settings. It never DROPs or ALTERs a table definition (the two agent append-only guard
-- triggers are disabled for the deletes and re-enabled inside the same transaction).
--
-- Written against the schema after 20261007100000_r13b_asset_prepaid_corrections and
-- 20261007110000_r13b_expenses_consolidation (legacy `expenses` dropped → expense vouchers are
-- financial_transactions; fixed_asset_cost_additions; assets / prepayments linked to purchase returns).
-- Schema-drift safe: every statement names its table and is skipped (NOTICE) when that table no longer exists
-- (to_regclass); the attachment cleanup derives its link tables from the FK catalog; the activity-log cleanup only
-- reads entity tables that exist. A NEW table holding a RESTRICT link to deleted rows still fails closed (rollback).
--
-- GUARD — runs ONLY on Production. Both markers must hold; on every other database the block is a no-op:
--   1. Production product PRD-2026-000041 «كومبو بوكس اهم 5000 كلمة» (random UUID 6ba85694-…-8de7263d0774,
--      seen by the R13 Production survey; it exists in no local / seed / CI database), same id AND same SKU;
--   2. the database is a Supabase project (role `supabase_admin` exists) — a pg_dump of Production restored
--      into a local or CI Postgres therefore never resets itself.
-- Prisma records the migration in _prisma_migrations, so it runs exactly once per database.
--
-- The whole body is ONE DO statement = one transaction: any error rolls everything back (nothing half-deleted).
DO $$
DECLARE
  -- ── OWNER SWITCHES (reset-plan.md §7) ── decided before the release; the defaults are the recommendations.
  keep_opening_balance       boolean := true;  -- R-O1: keep each fiscal year's Opening Balance entry (+ its reversal) so posting stays possible
  reset_investment_contracts boolean := true;  -- R-O2: also delete investment opportunities + opportunity products (investor profiles are kept)
  keep_crm_leads             boolean := true;  -- R-O3: keep CRM leads and their timeline (pipeline records, not financial)

  is_production boolean;
  stmt  text;
  tbl   text;
  cond  text;
  pair  text;
  n     bigint;
  total bigint := 0;
  stmts text[];
  guard_triggers constant text[] := ARRAY[
    'agent_ledger_entries:agent_ledger_entries_guard_trg',
    'agent_commission_lines:agent_commission_lines_guard_trg'
  ];
  -- activity-log entity type : table holding that entity (all deleted here, or conditionally deleted)
  logged_entities constant text[] := ARRAY[
    'CAPITAL_CONTRIBUTION:capital_contributions', 'CAPITAL_RETURN:capital_returns',
    'CARRIER_CHARGE:carrier_charges', 'DISTRIBUTION_PAYMENT:distribution_payments',
    'EXPENSE:financial_transactions',  -- legacy expense rows became EXPENSE_PAYMENT vouchers with the same id (r13b)
    'FIXED_ASSET:fixed_assets', 'PREPAID_EXPENSE:prepaid_expenses',
    'INVESTOR_SUBSCRIPTION:investor_subscriptions', 'OPPORTUNITY_EXPENSE:opportunity_expenses',
    'OPPORTUNITY_REALLOCATION:opportunity_reallocations', 'OPPORTUNITY_SALE_ALLOCATION:opportunity_sale_allocations',
    'OPPORTUNITY_SETTLEMENT:opportunity_settlements', 'PROFIT_CALCULATION:profit_calculations',
    'PROFIT_DISTRIBUTION:profit_distributions', 'INVESTMENT_OPPORTUNITY:investment_opportunities',
    'LEAD:leads'
  ];
BEGIN
  is_production :=
        EXISTS (SELECT 1 FROM "products"
                WHERE "id" = '6ba85694-5fac-48ae-b501-8de7263d0774' AND "sku" = 'PRD-2026-000041')
    AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin');

  IF NOT is_production THEN
    RAISE NOTICE 'r13 reset: Production markers absent — nothing changed (no-op).';
    RETURN;
  END IF;

  RAISE NOTICE 'r13 reset: Production markers present — resetting test transactions (keep_opening_balance=%, reset_investment_contracts=%, keep_crm_leads=%)',
    keep_opening_balance, reset_investment_contracts, keep_crm_leads;

  -- Journal entries that survive: each fiscal year's go-live Opening Balance entry and any entry that reverses it.
  CREATE TEMP TABLE r13_kept_journal_entries ON COMMIT DROP AS
    SELECT je."id" FROM "journal_entries" je
    WHERE keep_opening_balance
      AND (je."source_type" = 'OPENING_BALANCE'
           OR je."reversal_of_entry_id" IN (SELECT o."id" FROM "journal_entries" o WHERE o."source_type" = 'OPENING_BALANCE'));

  -- The agent ledger and its commission lines are append-only by trigger; lifted for this transaction only.
  FOREACH pair IN ARRAY guard_triggers LOOP
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass(format('public.%I', split_part(pair, ':', 1)))
                                          AND tgname = split_part(pair, ':', 2)) THEN
      EXECUTE format('ALTER TABLE %I DISABLE TRIGGER %I', split_part(pair, ':', 1), split_part(pair, ':', 2));
    END IF;
  END LOOP;

  -- Children before parents (FK-safe). Nullable links in KEPT tables are ON DELETE SET NULL; the only one that
  -- points at deleted rows (sync_source_configs.import_job_id = "latest sync run" pointer) is cleared explicitly.
  stmts := ARRAY[
    -- Agents: settlement history (agents, agreements, rates, destinations, commission overrides are kept)
    'DELETE FROM "agent_payout_attachments"',
    'DELETE FROM "agent_payout_allocations"',
    'DELETE FROM "agent_commission_lines"',
    'DELETE FROM "agent_order_returns"',
    'DELETE FROM "agent_ledger_entries"',
    'DELETE FROM "agent_payouts"',
    -- Investors: money and profit flows (investor profiles, types, portal accounts are kept)
    'DELETE FROM "investor_ledger_entries"',
    'DELETE FROM "distribution_payment_attachments"',
    'DELETE FROM "distribution_payments"',
    'DELETE FROM "investor_distributions"',
    'DELETE FROM "profit_distributions"',
    'DELETE FROM "profit_calculation_investor_shares"',
    'DELETE FROM "profit_calculations"',
    'DELETE FROM "capital_contribution_attachments"',
    'DELETE FROM "capital_contributions"',
    'DELETE FROM "capital_returns"',
    'DELETE FROM "opportunity_reallocations"',
    'DELETE FROM "opportunity_sale_allocations"',
    'DELETE FROM "opportunity_settlements"',
    'DELETE FROM "opportunity_expense_attachments"',
    'DELETE FROM "opportunity_expenses"',
    'DELETE FROM "investor_subscriptions"',
    -- Customer receipts, settlements, bank and statement reconciliation
    'DELETE FROM "payment_activities"',
    'DELETE FROM "payment_attachments"',
    'DELETE FROM "payment_matches"',
    'DELETE FROM "payment_notes"',
    'DELETE FROM "payment_receipt_links"',
    'DELETE FROM "payment_settlement_lines"',
    'DELETE FROM "payment_settlements"',
    'DELETE FROM "store_order_receipts"',
    'DELETE FROM "bank_transactions"',
    'DELETE FROM "payments"',
    'DELETE FROM "payment_statement_lines"',
    'DELETE FROM "payment_statement_imports"',
    -- Financial transactions (receipts / vouchers / refunds / supplier payments / expense vouchers)
    'DELETE FROM "financial_transaction_activities"',
    'DELETE FROM "financial_transaction_allocations"',
    'DELETE FROM "financial_transactions"',
    -- Shipping
    'DELETE FROM "carrier_charges"',
    'DELETE FROM "carrier_charge_imports"',
    'DELETE FROM "shipment_attachments"',
    'DELETE FROM "sales_order_attachments"',
    'DELETE FROM "shipments"',
    -- Sales documents
    'DELETE FROM "sales_return_activities"',
    'DELETE FROM "sales_return_items"',
    'DELETE FROM "sales_returns"',
    'DELETE FROM "sales_invoice_activities"',
    'DELETE FROM "sales_invoice_items"',
    'DELETE FROM "sales_invoices"',
    'DELETE FROM "sales_order_document_activities"',
    'DELETE FROM "sales_order_document_items"',
    'DELETE FROM "sales_order_documents"',
    'DELETE FROM "sales_quotation_activities"',
    'DELETE FROM "sales_quotation_items"',
    'DELETE FROM "sales_quotations"',
    -- Legacy sales orders
    'DELETE FROM "sales_order_activities"',
    'DELETE FROM "sales_order_notes"',
    'DELETE FROM "sales_order_status_history"',
    'DELETE FROM "order_items"',
    'DELETE FROM "sales_orders"',
    -- Store orders
    'DELETE FROM "store_order_activities"',
    'DELETE FROM "store_order_amendments"',
    'DELETE FROM "store_order_fulfillment_costs"',
    'DELETE FROM "store_order_items"',
    'DELETE FROM "store_orders"',
    -- Schedules created by documents — before the purchase returns / invoices they link to (r13b:
    -- fixed_assets.purchase_return_id, prepaid_expenses.purchase_return_id, fixed_asset_cost_additions →
    -- purchase_invoice_items RESTRICT, purchase_invoice_items.linked_fixed_asset_id)
    'DELETE FROM "fixed_asset_cost_additions"',
    'DELETE FROM "fixed_asset_depreciation_periods"',
    'DELETE FROM "fixed_assets"',
    'DELETE FROM "prepaid_recognitions"',
    'DELETE FROM "prepaid_expenses"',
    'DELETE FROM "accrued_expenses"',
    -- Purchasing documents
    'DELETE FROM "landed_cost_activities"',
    'DELETE FROM "landed_cost_allocations"',
    'DELETE FROM "landed_cost_lines"',
    'DELETE FROM "landed_cost_documents"',
    'DELETE FROM "purchase_return_activities"',
    'DELETE FROM "purchase_return_items"',
    'DELETE FROM "purchase_returns"',
    'DELETE FROM "purchase_invoice_activities"',
    'DELETE FROM "purchase_invoice_items"',
    'DELETE FROM "purchase_invoices"',
    'DELETE FROM "purchase_order_activities"',
    'DELETE FROM "purchase_order_items"',
    'DELETE FROM "purchase_orders"',
    'DELETE FROM "purchase_quotation_activities"',
    'DELETE FROM "purchase_quotation_items"',
    'DELETE FROM "purchase_quotations"',
    -- Inventory
    'DELETE FROM "inventory_movement_activities"',
    'DELETE FROM "physical_count_lines"',
    'DELETE FROM "physical_counts"',
    'DELETE FROM "assembly_order_lines"',
    'DELETE FROM "assembly_orders"',
    'DELETE FROM "inventory_movements"',
    -- Costing (cost history / snapshot are derived from the deleted documents)
    'DELETE FROM "product_cost_histories"',
    'DELETE FROM "product_cost_snapshots"',
    'DELETE FROM "cost_allocation_results"',
    'DELETE FROM "cost_allocation_runs"',
    -- Payroll / commission / KPI runs (plans, templates, components, employees are kept)
    'DELETE FROM "payroll_line_components"',
    'DELETE FROM "payroll_lines"',
    'DELETE FROM "payroll_runs"',
    'DELETE FROM "kpi_evaluation_audit_logs"',
    'DELETE FROM "kpi_evaluation_items"',
    'DELETE FROM "kpi_evaluations"',
    'DELETE FROM "commission_adjustments"',
    'DELETE FROM "commission_calculations"',
    -- Accounting
    'DELETE FROM "analytic_distribution_lines"',
    'DELETE FROM "fx_revaluation_runs"',
    'DELETE FROM "journal_entry_activities" WHERE "journal_entry_id" NOT IN (SELECT "id" FROM r13_kept_journal_entries)',
    'DELETE FROM "journal_entry_lines" WHERE "journal_entry_id" NOT IN (SELECT "id" FROM r13_kept_journal_entries)',
    'DELETE FROM "journal_entries" WHERE "id" NOT IN (SELECT "id" FROM r13_kept_journal_entries)',
    -- Import Center run history (mapping templates and Google-Sheets sync sources are kept)
    'UPDATE "sync_source_configs" SET "import_job_id" = NULL WHERE "import_job_id" IS NOT NULL',
    'DELETE FROM "import_job_errors"',
    'DELETE FROM "import_jobs"'
  ];

  IF reset_investment_contracts THEN
    stmts := stmts || ARRAY[
      'DELETE FROM "opportunity_products"',
      'DELETE FROM "investment_opportunities"'
    ];
  END IF;

  IF NOT keep_crm_leads THEN
    stmts := stmts || ARRAY[
      'DELETE FROM "lead_activities"',
      'DELETE FROM "lead_assignments"',
      'DELETE FROM "lead_follow_ups"',
      'DELETE FROM "lead_notes"',
      'DELETE FROM "lead_views"',
      'DELETE FROM "workflow_approvals" WHERE "entity_type" = ''LEAD''',
      'DELETE FROM "status_history" WHERE "entity_type" = ''LEAD''',
      'DELETE FROM "leads"'
    ];
  END IF;

  -- Derived cost on the kept product master
  stmts := array_append(stmts, 'UPDATE "products" SET "current_cost" = NULL, "last_cost_update" = NULL WHERE "current_cost" IS NOT NULL OR "last_cost_update" IS NOT NULL'::text);

  FOREACH stmt IN ARRAY stmts LOOP
    tbl := substring(stmt FROM '^(?:DELETE FROM|UPDATE) "([a-z_]+)"');
    IF to_regclass(format('public.%I', tbl)) IS NULL THEN
      RAISE NOTICE 'r13 reset: skipped — table "%" does not exist', tbl;
      CONTINUE;
    END IF;
    EXECUTE stmt;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    RAISE NOTICE 'r13 reset: % rows — %', lpad(n::text, 7), left(stmt, 110);
  END LOOP;

  -- File records that no row references any more — link tables read from the FK catalog (storage objects stay).
  IF to_regclass('public.attachments') IS NOT NULL THEN
    SELECT string_agg(format('NOT EXISTS (SELECT 1 FROM %s x WHERE x.%I = a."id")', c.conrelid::regclass, att.attname), ' AND ')
      INTO cond
      FROM pg_constraint c
      JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = 'public.attachments'::regclass AND c.conrelid <> c.confrelid;
    EXECUTE 'DELETE FROM "attachments" a WHERE ' || coalesce(cond, 'TRUE');
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    RAISE NOTICE 'r13 reset: % rows — DELETE FROM "attachments" (unreferenced)', lpad(n::text, 7);
  END IF;

  -- Timeline rows of deleted entities (polymorphic log; rows of kept master data stay). An entity table that no
  -- longer exists means no row of that type can still exist.
  IF to_regclass('public.master_data_activity_logs') IS NOT NULL THEN
    cond := NULL;
    FOREACH pair IN ARRAY logged_entities LOOP
      tbl := split_part(pair, ':', 2);
      cond := coalesce(cond || ' OR ', '') || CASE
        WHEN to_regclass(format('public.%I', tbl)) IS NULL
          THEN format('(l."entity_type" = %L)', split_part(pair, ':', 1))
        ELSE format('(l."entity_type" = %L AND NOT EXISTS (SELECT 1 FROM %I e WHERE e."id" = l."entity_id"))',
                    split_part(pair, ':', 1), tbl)
      END;
    END LOOP;
    EXECUTE 'DELETE FROM "master_data_activity_logs" l WHERE ' || cond;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    RAISE NOTICE 'r13 reset: % rows — DELETE FROM "master_data_activity_logs" (deleted entities)', lpad(n::text, 7);
  END IF;

  FOREACH pair IN ARRAY guard_triggers LOOP
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass(format('public.%I', split_part(pair, ':', 1)))
                                          AND tgname = split_part(pair, ':', 2)) THEN
      EXECUTE format('ALTER TABLE %I ENABLE TRIGGER %I', split_part(pair, ':', 1), split_part(pair, ':', 2));
    END IF;
  END LOOP;

  -- Post-conditions: fail (and roll back) rather than leave a half-reset ledger.
  IF EXISTS (SELECT 1 FROM "inventory_movements") OR EXISTS (SELECT 1 FROM "store_orders")
     OR EXISTS (SELECT 1 FROM "payments") OR EXISTS (SELECT 1 FROM "agent_ledger_entries")
     OR EXISTS (SELECT 1 FROM "financial_transactions") OR EXISTS (SELECT 1 FROM "purchase_returns")
     OR EXISTS (SELECT 1 FROM "fixed_assets") OR EXISTS (SELECT 1 FROM "prepaid_expenses")
     OR EXISTS (SELECT 1 FROM "journal_entries" WHERE "id" NOT IN (SELECT "id" FROM r13_kept_journal_entries))
     OR EXISTS (SELECT 1 FROM "products" WHERE "current_cost" IS NOT NULL) THEN
    RAISE EXCEPTION 'r13 reset: post-condition failed — rolled back';
  END IF;
  IF EXISTS (SELECT 1 FROM "journal_entries" je
             JOIN "journal_entry_lines" l ON l."journal_entry_id" = je."id"
             GROUP BY je."id" HAVING sum(l."debit") <> sum(l."credit")) THEN
    RAISE EXCEPTION 'r13 reset: a kept journal entry is unbalanced — rolled back';
  END IF;

  RAISE NOTICE 'r13 reset: done — % rows deleted/cleared; % journal entries kept (opening balance).',
    total, (SELECT count(*) FROM r13_kept_journal_entries);
END $$;
