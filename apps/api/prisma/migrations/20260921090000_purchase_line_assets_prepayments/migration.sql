-- Item 10: Purchase Invoice lines can capitalize a Fixed Asset or defer a
-- Prepaid Expense. Additive only: new enum/columns, nullable links, unique
-- per invoice line so a re-post can never create a second asset/prepayment.

ALTER TYPE "DepreciationMethod" ADD VALUE IF NOT EXISTS 'DECLINING_BALANCE';

CREATE TYPE "PurchaseLineTreatment" AS ENUM ('STANDARD', 'FIXED_ASSET', 'PREPAID_EXPENSE');

ALTER TABLE "purchase_invoice_items"
  ADD COLUMN "treatment" "PurchaseLineTreatment" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "asset_useful_life_months" INTEGER,
  ADD COLUMN "asset_depreciation_method" "DepreciationMethod",
  ADD COLUMN "schedule_start_date" DATE,
  ADD COLUMN "prepaid_months" INTEGER,
  ADD COLUMN "prepaid_expense_account_id" UUID;

ALTER TABLE "purchase_invoice_items"
  ADD CONSTRAINT "purchase_invoice_items_prepaid_expense_account_id_fkey"
  FOREIGN KEY ("prepaid_expense_account_id") REFERENCES "chart_of_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fixed_assets"
  ADD COLUMN "purchase_invoice_id" UUID,
  ADD COLUMN "purchase_invoice_item_id" UUID;
CREATE UNIQUE INDEX "fixed_assets_purchase_invoice_item_id_key" ON "fixed_assets"("purchase_invoice_item_id");
ALTER TABLE "fixed_assets"
  ADD CONSTRAINT "fixed_assets_purchase_invoice_id_fkey"
  FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "fixed_assets_purchase_invoice_item_id_fkey"
  FOREIGN KEY ("purchase_invoice_item_id") REFERENCES "purchase_invoice_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "prepaid_expenses"
  ADD COLUMN "purchase_invoice_id" UUID,
  ADD COLUMN "purchase_invoice_item_id" UUID;
CREATE UNIQUE INDEX "prepaid_expenses_purchase_invoice_item_id_key" ON "prepaid_expenses"("purchase_invoice_item_id");
ALTER TABLE "prepaid_expenses"
  ADD CONSTRAINT "prepaid_expenses_purchase_invoice_id_fkey"
  FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "prepaid_expenses_purchase_invoice_item_id_fkey"
  FOREIGN KEY ("purchase_invoice_item_id") REFERENCES "purchase_invoice_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fixed_asset_depreciation_periods"
  ADD COLUMN "last_error" TEXT,
  ADD COLUMN "last_attempt_at" TIMESTAMP(3);

ALTER TABLE "prepaid_recognitions"
  ADD COLUMN "last_error" TEXT,
  ADD COLUMN "last_attempt_at" TIMESTAMP(3);

-- An invoice-deferred prepayment is credited to Accounts Payable by the
-- invoice itself, so it has no cash/bank receiving account.
ALTER TABLE "prepaid_expenses" ALTER COLUMN "receiving_account_id" DROP NOT NULL;
