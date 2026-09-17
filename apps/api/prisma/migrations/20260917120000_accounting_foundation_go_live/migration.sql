-- Accounting foundation: bilingual CoA names + operating-cost posting maps.
-- Idempotent: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

ALTER TABLE "chart_of_accounts" ADD COLUMN IF NOT EXISTS "name_en" TEXT;

ALTER TABLE "posting_settings" ADD COLUMN IF NOT EXISTS "shipping_expense_account_id" UUID;
ALTER TABLE "posting_settings" ADD COLUMN IF NOT EXISTS "accrued_shipping_account_id" UUID;
ALTER TABLE "posting_settings" ADD COLUMN IF NOT EXISTS "payment_gateway_fee_account_id" UUID;
ALTER TABLE "posting_settings" ADD COLUMN IF NOT EXISTS "fulfillment_expense_account_id" UUID;
ALTER TABLE "posting_settings" ADD COLUMN IF NOT EXISTS "accrued_fulfillment_account_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posting_settings_shipping_expense_account_id_fkey'
  ) THEN
    ALTER TABLE "posting_settings"
      ADD CONSTRAINT "posting_settings_shipping_expense_account_id_fkey"
      FOREIGN KEY ("shipping_expense_account_id") REFERENCES "chart_of_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posting_settings_accrued_shipping_account_id_fkey'
  ) THEN
    ALTER TABLE "posting_settings"
      ADD CONSTRAINT "posting_settings_accrued_shipping_account_id_fkey"
      FOREIGN KEY ("accrued_shipping_account_id") REFERENCES "chart_of_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posting_settings_payment_gateway_fee_account_id_fkey'
  ) THEN
    ALTER TABLE "posting_settings"
      ADD CONSTRAINT "posting_settings_payment_gateway_fee_account_id_fkey"
      FOREIGN KEY ("payment_gateway_fee_account_id") REFERENCES "chart_of_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posting_settings_fulfillment_expense_account_id_fkey'
  ) THEN
    ALTER TABLE "posting_settings"
      ADD CONSTRAINT "posting_settings_fulfillment_expense_account_id_fkey"
      FOREIGN KEY ("fulfillment_expense_account_id") REFERENCES "chart_of_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posting_settings_accrued_fulfillment_account_id_fkey'
  ) THEN
    ALTER TABLE "posting_settings"
      ADD CONSTRAINT "posting_settings_accrued_fulfillment_account_id_fkey"
      FOREIGN KEY ("accrued_fulfillment_account_id") REFERENCES "chart_of_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
