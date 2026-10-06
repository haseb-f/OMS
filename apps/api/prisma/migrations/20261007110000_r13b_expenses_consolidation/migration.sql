-- Round 13 follow-up (owner decision 2) — ONE expense concept.
--
-- The Expenses screen stays and becomes the UI of the posting expense
-- voucher (`financial_transactions`, type EXPENSE_PAYMENT). The legacy,
-- postless `expenses` table is consolidated into it and removed:
--
--   1. `financial_transactions.description` — what was spent (carried onto
--      the journal line description).
--   2. Legacy rows → EXPENSE_PAYMENT DRAFT vouchers (never posted here; a
--      user confirms them explicitly). The expense account is resolved from
--      Accounting Settings → default expense account, only when that is an
--      active EXPENSE posting account. Active rows with a positive amount
--      convert; archived rows, zero amounts, or no resolvable account are
--      dropped as unusable test rows (owner: all existing data is test data).
--      The voucher keeps the legacy row id, so an Investor opportunity cost
--      that referenced the row keeps its link. Payment Method → its channel
--      (payment source) and the receiving account on its ledger account.
--      Counts are reported with RAISE NOTICE.
--   3. `opportunity_expenses.source_expense_id` now references the voucher.
--   4. `expenses` is dropped.
--   5. Permissions: `masterdata.expenses.{view,create,edit,archive}` map to
--      `accounting.expense-payments.{view,create,edit,archive}` for every
--      user who held them (additive, idempotent). Confirm / cancel (posting)
--      are NOT granted by the mapping — the legacy screen never posted, so
--      no role gains posting authority. The legacy names are then removed.

-- 1 ------------------------------------------------------------------------
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- BEGIN legacy-conversion ---------------------------------------------------
DO $$
DECLARE
  legacy_total integer;
  converted integer := 0;
  default_account uuid;
BEGIN
  SELECT count(*) INTO legacy_total FROM "expenses";

  SELECT ps."default_expense_account_id" INTO default_account
  FROM "posting_settings" ps
  JOIN "chart_of_accounts" a ON a."id" = ps."default_expense_account_id"
  WHERE a."account_type" = 'EXPENSE'
    AND a."allows_posting" = true
    -- Active = not archived: `chart_of_accounts` has no is_active / status column — archiving sets deleted_at
    -- (the same test the expense voucher's own account check applies).
    AND a."deleted_at" IS NULL
  LIMIT 1;

  IF default_account IS NOT NULL THEN
    INSERT INTO "financial_transactions" (
      "id", "transaction_number", "type", "expense_account_id",
      "cost_center_id", "transaction_date", "payment_source_id",
      "receiving_account_id", "amount", "fee_amount", "description", "notes",
      "status", "created_at", "updated_at", "created_by", "updated_by"
    )
    SELECT
      e."id",
      'EP-LEGACY-' || lpad((row_number() OVER (ORDER BY e."created_at", e."id"))::text, 6, '0'),
      'EXPENSE_PAYMENT',
      default_account,
      e."cost_center_id",
      e."date",
      pm."payment_source_id",
      ra."id",
      e."amount",
      0,
      e."description",
      e."notes",
      'DRAFT',
      e."created_at",
      CURRENT_TIMESTAMP,
      e."created_by",
      e."updated_by"
    FROM "expenses" e
    LEFT JOIN "payment_methods" pm ON pm."id" = e."payment_method_id"
    LEFT JOIN LATERAL (
      SELECT r."id"
      FROM "receiving_accounts" r
      WHERE r."chart_of_account_id" = pm."account_id"
        AND r."deleted_at" IS NULL
        AND r."is_active" = true
      ORDER BY r."is_default" DESC, r."created_at"
      LIMIT 1
    ) ra ON true
    WHERE e."deleted_at" IS NULL
      AND e."amount" > 0;
    GET DIAGNOSTICS converted = ROW_COUNT;
  END IF;

  RAISE NOTICE 'r13b expenses consolidation: % legacy rows, % converted to EXPENSE_PAYMENT drafts, % dropped (archived / zero amount / no resolvable expense account)',
    legacy_total, converted, legacy_total - converted;
END $$;
-- END legacy-conversion -----------------------------------------------------

-- 3 ------------------------------------------------------------------------
ALTER TABLE "opportunity_expenses" DROP CONSTRAINT IF EXISTS "opportunity_expenses_source_expense_id_fkey";

UPDATE "opportunity_expenses" oe
SET "source_expense_id" = NULL
WHERE oe."source_expense_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "financial_transactions" ft
    WHERE ft."id" = oe."source_expense_id" AND ft."type" = 'EXPENSE_PAYMENT'
  );

ALTER TABLE "opportunity_expenses"
  ADD CONSTRAINT "opportunity_expenses_source_expense_id_fkey"
  FOREIGN KEY ("source_expense_id") REFERENCES "financial_transactions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 4 ------------------------------------------------------------------------
DROP TABLE "expenses";

-- BEGIN permission-mapping --------------------------------------------------
INSERT INTO "permissions" ("id", "name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), v."name", 'Permission Matrix: ' || v."name", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('accounting.expense-payments.view'),
  ('accounting.expense-payments.create'),
  ('accounting.expense-payments.edit'),
  ('accounting.expense-payments.archive')
) AS v("name")
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."name" = v."name");

INSERT INTO "user_permissions" ("id", "user_id", "permission_id", "created_at")
SELECT gen_random_uuid(), held."user_id", target."id", CURRENT_TIMESTAMP
FROM "user_permissions" held
JOIN "permissions" legacy ON legacy."id" = held."permission_id"
JOIN (VALUES
  ('masterdata.expenses.view', 'accounting.expense-payments.view'),
  ('masterdata.expenses.create', 'accounting.expense-payments.create'),
  ('masterdata.expenses.edit', 'accounting.expense-payments.edit'),
  ('masterdata.expenses.archive', 'accounting.expense-payments.archive')
) AS m("legacy_name", "target_name") ON m."legacy_name" = legacy."name"
JOIN "permissions" target ON target."name" = m."target_name"
ON CONFLICT ("user_id", "permission_id") DO NOTHING;

DELETE FROM "permissions" WHERE "name" IN (
  'masterdata.expenses.view',
  'masterdata.expenses.create',
  'masterdata.expenses.edit',
  'masterdata.expenses.archive'
);
-- END permission-mapping ----------------------------------------------------
