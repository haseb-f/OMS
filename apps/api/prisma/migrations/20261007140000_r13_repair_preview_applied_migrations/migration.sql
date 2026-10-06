-- R13 repair — Production received EARLY versions of two R13 migrations through Vercel Preview builds.
--
-- `scripts/vercel-build.sh` runs `prisma migrate deploy` in every Vercel environment, and the Preview builds of the
-- R13 accounting branch evidently used the Production database. Prisma never re-runs a migration it has recorded, so the
-- later edits of those files never reached Production. Found on 2026-10-06: every purchase-invoice read failed with
-- DATABASE_ERROR because `purchase_invoice_items.tax_capitalized` (added to 20261007100000 in 9e56a551, after the 13:26
-- Preview of b8032656 had applied the first version) does not exist there.
--
-- This migration re-applies the missing differences idempotently — a no-op on every database that ran the final files:
--   1. 20261007100000_r13b_asset_prepaid_corrections — the `tax_capitalized` column and its data step (7).
--      Its edited data steps (4) and (6) recompute derived figures of prepaid expenses / fixed assets; those tables hold
--      no rows on Production after the R13 test-data reset, so there is nothing to recompute.
--   2. 20261006120000_r13_payment_method_channel — the later edits (deterministic backfill tie-break, consolidation of
--      duplicate ACTIVE payment matches) only change data that the reset removed or that was already backfilled; the
--      structural part (columns, index, CHECK) was identical in every version.
--   3. 20261007110000_r13b_expenses_consolidation — the later edit is a comment only.

ALTER TABLE "purchase_invoice_items" ADD COLUMN IF NOT EXISTS "tax_capitalized" BOOLEAN NOT NULL DEFAULT false;

-- (= 20261007100000 step 7) Freeze the tax-capitalization decision of already-confirmed FIXED_ASSET lines.
UPDATE "purchase_invoice_items" i
SET "tax_capitalized" = true
FROM "purchase_invoices" pi, "taxes" t
WHERE pi."id" = i."purchase_invoice_id"
  AND t."id" = i."tax_id"
  AND pi."status" IN ('CONFIRMED', 'CLOSED')
  AND i."treatment" = 'FIXED_ASSET'
  AND t."is_recoverable" = false
  AND i."tax_capitalized" = false;
