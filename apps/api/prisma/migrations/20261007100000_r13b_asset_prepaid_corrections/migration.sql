-- Round 13b — fixed assets / prepaid expenses follow-up (owner decisions O-1, O-2, O-3, O-7, O-8).
--
-- Schema:
--   * taxes.is_recoverable                     — non-recoverable input tax is capitalized on FIXED_ASSET lines (O-2, IAS 16)
--   * purchase_invoice_items.linked_fixed_asset_id + fixed_asset_cost_additions
--                                              — a later invoice line adds a directly attributable cost to an existing asset (O-2)
--   * fixed_assets.disposal_partner_id         — disposal proceeds settled as a supplier credit (O-1)
--   * fixed_assets.purchase_return_id          — asset derecognized by a purchase return of its invoice line (O-1)
--   * prepaid_expenses closure columns          — Cancel with refund / Recognize remaining now / purchase return (O-3)
--
-- Data (all existing rows are test data — owner approval, R13b): status-only corrections of schedule rows and
-- derived dates. No journal entry is created, changed or deleted. Counts on the developer DB (oms_x, seeded
-- with one inconsistent row of each kind) are recorded in specs/round13-accounting-reporting/evidence-C.md (R13b);
-- the read-only check is specs/round13-accounting-reporting/proposals/asset-prepaid-corrections-check.sql.

-- CreateEnum
CREATE TYPE "PrepaidClosureType" AS ENUM ('REFUND', 'RECOGNIZED', 'PURCHASE_RETURN');

-- AlterTable
ALTER TABLE "fixed_assets" ADD COLUMN     "disposal_partner_id" UUID,
ADD COLUMN     "purchase_return_id" UUID;

-- AlterTable
ALTER TABLE "prepaid_expenses" ADD COLUMN     "accelerated_amount" DECIMAL(12,2),
ADD COLUMN     "closed_by" UUID,
ADD COLUMN     "closed_on" DATE,
ADD COLUMN     "closure_type" "PrepaidClosureType",
ADD COLUMN     "purchase_return_id" UUID,
ADD COLUMN     "refund_amount" DECIMAL(12,2),
ADD COLUMN     "refund_partner_id" UUID,
ADD COLUMN     "refund_receiving_account_id" UUID;

-- AlterTable
ALTER TABLE "purchase_invoice_items" ADD COLUMN     "linked_fixed_asset_id" UUID;

-- AlterTable
ALTER TABLE "taxes" ADD COLUMN     "is_recoverable" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "fixed_asset_cost_additions" (
    "id" UUID NOT NULL,
    "fixed_asset_id" UUID NOT NULL,
    "purchase_invoice_item_id" UUID NOT NULL,
    "purchase_invoice_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "added_on" DATE NOT NULL,
    "respread_periods" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "fixed_asset_cost_additions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fixed_asset_cost_additions_purchase_invoice_item_id_key" ON "fixed_asset_cost_additions"("purchase_invoice_item_id");

-- CreateIndex
CREATE INDEX "fixed_asset_cost_additions_fixed_asset_id_idx" ON "fixed_asset_cost_additions"("fixed_asset_id");

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_disposal_partner_id_fkey" FOREIGN KEY ("disposal_partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_purchase_return_id_fkey" FOREIGN KEY ("purchase_return_id") REFERENCES "purchase_returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_cost_additions" ADD CONSTRAINT "fixed_asset_cost_additions_fixed_asset_id_fkey" FOREIGN KEY ("fixed_asset_id") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_asset_cost_additions" ADD CONSTRAINT "fixed_asset_cost_additions_purchase_invoice_item_id_fkey" FOREIGN KEY ("purchase_invoice_item_id") REFERENCES "purchase_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepaid_expenses" ADD CONSTRAINT "prepaid_expenses_refund_partner_id_fkey" FOREIGN KEY ("refund_partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepaid_expenses" ADD CONSTRAINT "prepaid_expenses_refund_receiving_account_id_fkey" FOREIGN KEY ("refund_receiving_account_id") REFERENCES "receiving_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepaid_expenses" ADD CONSTRAINT "prepaid_expenses_purchase_return_id_fkey" FOREIGN KEY ("purchase_return_id") REFERENCES "purchase_returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_linked_fixed_asset_id_fkey" FOREIGN KEY ("linked_fixed_asset_id") REFERENCES "fixed_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- R13b-DATA-FIX:BEGIN
-- Every statement is idempotent (re-running changes nothing) and touches schedule status / derived columns only.

-- (1) O-8: PENDING depreciation periods of DISPOSED or archived assets can never post (the run skips them) →
--     CANCELLED, exactly what a disposal does today.
UPDATE "fixed_asset_depreciation_periods" p
SET "status" = 'CANCELLED', "last_attempt_at" = CURRENT_TIMESTAMP
FROM "fixed_assets" a
WHERE a."id" = p."fixed_asset_id"
  AND p."status" = 'PENDING'
  AND (a."status" = 'DISPOSED' OR a."deleted_at" IS NOT NULL);

-- (2) Schedule rows left on a DRAFT asset (a draft has no schedule — capitalization rebuilds it) → removed.
--     Never POSTED (a draft never posts), so no journal entry refers to them.
DELETE FROM "fixed_asset_depreciation_periods" p
USING "fixed_assets" a
WHERE a."id" = p."fixed_asset_id"
  AND a."status" = 'DRAFT'
  AND p."status" <> 'POSTED';

-- (3) PENDING recognitions of CANCELLED / COMPLETED prepayments can never post → CANCELLED.
UPDATE "prepaid_recognitions" r
SET "status" = 'CANCELLED', "last_attempt_at" = CURRENT_TIMESTAMP
FROM "prepaid_expenses" e
WHERE e."id" = r."prepaid_expense_id"
  AND r."status" = 'PENDING'
  AND e."status" IN ('CANCELLED', 'COMPLETED');

-- (4) Prepaid end date is derived: start + total periods months − 1 day.
UPDATE "prepaid_expenses"
SET "end_date" = ("start_date" + make_interval(months => "total_periods") - INTERVAL '1 day')::date
WHERE "end_date" <> ("start_date" + make_interval(months => "total_periods") - INTERVAL '1 day')::date;

-- (5) An ACTIVE prepayment whose every recognition is POSTED is complete.
UPDATE "prepaid_expenses" e
SET "status" = 'COMPLETED'
WHERE e."status" = 'ACTIVE'
  AND EXISTS (SELECT 1 FROM "prepaid_recognitions" r WHERE r."prepaid_expense_id" = e."id")
  AND NOT EXISTS (
    SELECT 1 FROM "prepaid_recognitions" r
    WHERE r."prepaid_expense_id" = e."id" AND r."status" <> 'POSTED'
  );

-- (6) Running totals equal the POSTED rows (each POSTED row has its own Posting Engine entry).
UPDATE "fixed_assets" a
SET "accumulated_depreciation" = s.total
FROM (
  SELECT a2."id", COALESCE(SUM(p."amount") FILTER (WHERE p."status" = 'POSTED'), 0) AS total
  FROM "fixed_assets" a2
  LEFT JOIN "fixed_asset_depreciation_periods" p ON p."fixed_asset_id" = a2."id"
  GROUP BY a2."id"
) s
WHERE s."id" = a."id" AND a."accumulated_depreciation" <> s.total;

UPDATE "prepaid_expenses" e
SET "recognized_amount" = s.total + COALESCE(e."accelerated_amount", 0)
FROM (
  SELECT e2."id", COALESCE(SUM(r."amount") FILTER (WHERE r."status" = 'POSTED'), 0) AS total
  FROM "prepaid_expenses" e2
  LEFT JOIN "prepaid_recognitions" r ON r."prepaid_expense_id" = e2."id"
  GROUP BY e2."id"
) s
WHERE s."id" = e."id" AND e."recognized_amount" <> s.total + COALESCE(e."accelerated_amount", 0);
-- R13b-DATA-FIX:END
