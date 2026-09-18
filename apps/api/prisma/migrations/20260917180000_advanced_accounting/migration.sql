-- Advanced Accounting: FA lifecycle, prepaid/accrual schedules, FX rates,
-- VAT inclusive flag, exchange-rate snapshots, posting-setting maps.

-- Tax inclusive flag
ALTER TABLE "taxes" ADD COLUMN IF NOT EXISTS "inclusive" BOOLEAN NOT NULL DEFAULT false;

-- Exchange-rate snapshots on posting documents
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "exchange_rate" DECIMAL(18,8);
ALTER TABLE "sales_returns" ADD COLUMN IF NOT EXISTS "exchange_rate" DECIMAL(18,8);
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "exchange_rate" DECIMAL(18,8);
ALTER TABLE "purchase_returns" ADD COLUMN IF NOT EXISTS "exchange_rate" DECIMAL(18,8);
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "exchange_rate" DECIMAL(18,8);
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "exchange_rate" DECIMAL(18,8);

-- Posting settings
ALTER TABLE "posting_settings" ADD COLUMN IF NOT EXISTS "fixed_assets_account_id" UUID;
ALTER TABLE "posting_settings" ADD COLUMN IF NOT EXISTS "accum_depreciation_account_id" UUID;
ALTER TABLE "posting_settings" ADD COLUMN IF NOT EXISTS "depreciation_expense_account_id" UUID;
ALTER TABLE "posting_settings" ADD COLUMN IF NOT EXISTS "prepayments_account_id" UUID;
ALTER TABLE "posting_settings" ADD COLUMN IF NOT EXISTS "accrued_expenses_account_id" UUID;
ALTER TABLE "posting_settings" ADD COLUMN IF NOT EXISTS "unrealized_fx_account_id" UUID;
ALTER TABLE "posting_settings" ADD COLUMN IF NOT EXISTS "other_income_account_id" UUID;
ALTER TABLE "posting_settings" ADD COLUMN IF NOT EXISTS "other_expense_account_id" UUID;
ALTER TABLE "posting_settings" ADD COLUMN IF NOT EXISTS "functional_currency_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posting_settings_fixed_assets_account_id_fkey') THEN
    ALTER TABLE "posting_settings"
      ADD CONSTRAINT "posting_settings_fixed_assets_account_id_fkey"
      FOREIGN KEY ("fixed_assets_account_id") REFERENCES "chart_of_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posting_settings_accum_depreciation_account_id_fkey') THEN
    ALTER TABLE "posting_settings"
      ADD CONSTRAINT "posting_settings_accum_depreciation_account_id_fkey"
      FOREIGN KEY ("accum_depreciation_account_id") REFERENCES "chart_of_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posting_settings_depreciation_expense_account_id_fkey') THEN
    ALTER TABLE "posting_settings"
      ADD CONSTRAINT "posting_settings_depreciation_expense_account_id_fkey"
      FOREIGN KEY ("depreciation_expense_account_id") REFERENCES "chart_of_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posting_settings_prepayments_account_id_fkey') THEN
    ALTER TABLE "posting_settings"
      ADD CONSTRAINT "posting_settings_prepayments_account_id_fkey"
      FOREIGN KEY ("prepayments_account_id") REFERENCES "chart_of_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posting_settings_accrued_expenses_account_id_fkey') THEN
    ALTER TABLE "posting_settings"
      ADD CONSTRAINT "posting_settings_accrued_expenses_account_id_fkey"
      FOREIGN KEY ("accrued_expenses_account_id") REFERENCES "chart_of_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posting_settings_unrealized_fx_account_id_fkey') THEN
    ALTER TABLE "posting_settings"
      ADD CONSTRAINT "posting_settings_unrealized_fx_account_id_fkey"
      FOREIGN KEY ("unrealized_fx_account_id") REFERENCES "chart_of_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posting_settings_other_income_account_id_fkey') THEN
    ALTER TABLE "posting_settings"
      ADD CONSTRAINT "posting_settings_other_income_account_id_fkey"
      FOREIGN KEY ("other_income_account_id") REFERENCES "chart_of_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posting_settings_other_expense_account_id_fkey') THEN
    ALTER TABLE "posting_settings"
      ADD CONSTRAINT "posting_settings_other_expense_account_id_fkey"
      FOREIGN KEY ("other_expense_account_id") REFERENCES "chart_of_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posting_settings_functional_currency_id_fkey') THEN
    ALTER TABLE "posting_settings"
      ADD CONSTRAINT "posting_settings_functional_currency_id_fkey"
      FOREIGN KEY ("functional_currency_id") REFERENCES "currencies"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Fixed assets lifecycle
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "useful_life_months" INTEGER;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "salvage_value" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "depreciation_method" TEXT NOT NULL DEFAULT 'STRAIGHT_LINE';
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "depreciation_start_date" DATE;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "accumulated_depreciation" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "receiving_account_id" UUID;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "partner_id" UUID;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "capitalized_at" TIMESTAMP(3);
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "capitalized_by" UUID;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "disposed_at" TIMESTAMP(3);
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "disposed_by" UUID;
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "disposal_amount" DECIMAL(12,2);
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "disposal_notes" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "fixed_assets_code_key" ON "fixed_assets"("code");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixed_assets_receiving_account_id_fkey') THEN
    ALTER TABLE "fixed_assets"
      ADD CONSTRAINT "fixed_assets_receiving_account_id_fkey"
      FOREIGN KEY ("receiving_account_id") REFERENCES "receiving_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixed_assets_partner_id_fkey') THEN
    ALTER TABLE "fixed_assets"
      ADD CONSTRAINT "fixed_assets_partner_id_fkey"
      FOREIGN KEY ("partner_id") REFERENCES "partners"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "fixed_asset_depreciation_periods" (
  "id" UUID NOT NULL,
  "fixed_asset_id" UUID NOT NULL,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "posted_at" TIMESTAMP(3),
  "posted_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fixed_asset_depreciation_periods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fixed_asset_depreciation_periods_fixed_asset_id_period_start_key"
  ON "fixed_asset_depreciation_periods"("fixed_asset_id", "period_start");
CREATE INDEX IF NOT EXISTS "fixed_asset_depreciation_periods_status_period_end_idx"
  ON "fixed_asset_depreciation_periods"("status", "period_end");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixed_asset_depreciation_periods_fixed_asset_id_fkey') THEN
    ALTER TABLE "fixed_asset_depreciation_periods"
      ADD CONSTRAINT "fixed_asset_depreciation_periods_fixed_asset_id_fkey"
      FOREIGN KEY ("fixed_asset_id") REFERENCES "fixed_assets"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prepaid_expenses" (
  "id" UUID NOT NULL,
  "prepaid_number" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  "total_periods" INTEGER NOT NULL,
  "recognized_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "expense_account_id" UUID NOT NULL,
  "receiving_account_id" UUID NOT NULL,
  "partner_id" UUID,
  "currency_id" UUID,
  "exchange_rate" DECIMAL(18,8),
  "activated_at" TIMESTAMP(3),
  "activated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by" UUID,
  "updated_by" UUID,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "prepaid_expenses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "prepaid_expenses_prepaid_number_key" ON "prepaid_expenses"("prepaid_number");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prepaid_expenses_expense_account_id_fkey') THEN
    ALTER TABLE "prepaid_expenses"
      ADD CONSTRAINT "prepaid_expenses_expense_account_id_fkey"
      FOREIGN KEY ("expense_account_id") REFERENCES "chart_of_accounts"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prepaid_expenses_receiving_account_id_fkey') THEN
    ALTER TABLE "prepaid_expenses"
      ADD CONSTRAINT "prepaid_expenses_receiving_account_id_fkey"
      FOREIGN KEY ("receiving_account_id") REFERENCES "receiving_accounts"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prepaid_expenses_partner_id_fkey') THEN
    ALTER TABLE "prepaid_expenses"
      ADD CONSTRAINT "prepaid_expenses_partner_id_fkey"
      FOREIGN KEY ("partner_id") REFERENCES "partners"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prepaid_expenses_currency_id_fkey') THEN
    ALTER TABLE "prepaid_expenses"
      ADD CONSTRAINT "prepaid_expenses_currency_id_fkey"
      FOREIGN KEY ("currency_id") REFERENCES "currencies"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prepaid_recognitions" (
  "id" UUID NOT NULL,
  "prepaid_expense_id" UUID NOT NULL,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "posted_at" TIMESTAMP(3),
  "posted_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prepaid_recognitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "prepaid_recognitions_prepaid_expense_id_period_start_key"
  ON "prepaid_recognitions"("prepaid_expense_id", "period_start");
CREATE INDEX IF NOT EXISTS "prepaid_recognitions_status_period_end_idx"
  ON "prepaid_recognitions"("status", "period_end");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prepaid_recognitions_prepaid_expense_id_fkey') THEN
    ALTER TABLE "prepaid_recognitions"
      ADD CONSTRAINT "prepaid_recognitions_prepaid_expense_id_fkey"
      FOREIGN KEY ("prepaid_expense_id") REFERENCES "prepaid_expenses"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "accrued_expenses" (
  "id" UUID NOT NULL,
  "accrual_number" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "recognition_date" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "expense_account_id" UUID NOT NULL,
  "receiving_account_id" UUID,
  "partner_id" UUID,
  "currency_id" UUID,
  "exchange_rate" DECIMAL(18,8),
  "recognized_at" TIMESTAMP(3),
  "recognized_by" UUID,
  "settled_at" TIMESTAMP(3),
  "settled_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by" UUID,
  "updated_by" UUID,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "accrued_expenses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "accrued_expenses_accrual_number_key" ON "accrued_expenses"("accrual_number");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accrued_expenses_expense_account_id_fkey') THEN
    ALTER TABLE "accrued_expenses"
      ADD CONSTRAINT "accrued_expenses_expense_account_id_fkey"
      FOREIGN KEY ("expense_account_id") REFERENCES "chart_of_accounts"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accrued_expenses_receiving_account_id_fkey') THEN
    ALTER TABLE "accrued_expenses"
      ADD CONSTRAINT "accrued_expenses_receiving_account_id_fkey"
      FOREIGN KEY ("receiving_account_id") REFERENCES "receiving_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accrued_expenses_partner_id_fkey') THEN
    ALTER TABLE "accrued_expenses"
      ADD CONSTRAINT "accrued_expenses_partner_id_fkey"
      FOREIGN KEY ("partner_id") REFERENCES "partners"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accrued_expenses_currency_id_fkey') THEN
    ALTER TABLE "accrued_expenses"
      ADD CONSTRAINT "accrued_expenses_currency_id_fkey"
      FOREIGN KEY ("currency_id") REFERENCES "currencies"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "exchange_rates" (
  "id" UUID NOT NULL,
  "from_currency_id" UUID NOT NULL,
  "to_currency_id" UUID NOT NULL,
  "rate" DECIMAL(18,8) NOT NULL,
  "effective_date" DATE NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "exchange_rates_from_currency_id_to_currency_id_effective_date_key"
  ON "exchange_rates"("from_currency_id", "to_currency_id", "effective_date");
CREATE INDEX IF NOT EXISTS "exchange_rates_effective_date_idx" ON "exchange_rates"("effective_date");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exchange_rates_from_currency_id_fkey') THEN
    ALTER TABLE "exchange_rates"
      ADD CONSTRAINT "exchange_rates_from_currency_id_fkey"
      FOREIGN KEY ("from_currency_id") REFERENCES "currencies"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exchange_rates_to_currency_id_fkey') THEN
    ALTER TABLE "exchange_rates"
      ADD CONSTRAINT "exchange_rates_to_currency_id_fkey"
      FOREIGN KEY ("to_currency_id") REFERENCES "currencies"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "fx_revaluation_runs" (
  "id" UUID NOT NULL,
  "run_number" TEXT NOT NULL,
  "rate_date" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'POSTED',
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  CONSTRAINT "fx_revaluation_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fx_revaluation_runs_run_number_key" ON "fx_revaluation_runs"("run_number");
CREATE UNIQUE INDEX IF NOT EXISTS "fx_revaluation_runs_rate_date_key" ON "fx_revaluation_runs"("rate_date");

INSERT INTO "number_series" (
  "id", "document_type", "label", "doc_code", "template",
  "next_number", "padding", "separator",
  "year_reset", "month_reset", "day_reset", "active",
  "created_at", "updated_at"
)
SELECT gen_random_uuid(), 'FIXED_ASSET', 'Fixed Asset', 'FA', '{DOC}-{YEAR}-{SEQ}',
  1, 6, '-', true, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "number_series" WHERE "document_type" = 'FIXED_ASSET');

INSERT INTO "number_series" (
  "id", "document_type", "label", "doc_code", "template",
  "next_number", "padding", "separator",
  "year_reset", "month_reset", "day_reset", "active",
  "created_at", "updated_at"
)
SELECT gen_random_uuid(), 'PREPAID_EXPENSE', 'Prepaid Expense', 'PE', '{DOC}-{YEAR}-{SEQ}',
  1, 6, '-', true, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "number_series" WHERE "document_type" = 'PREPAID_EXPENSE');

INSERT INTO "number_series" (
  "id", "document_type", "label", "doc_code", "template",
  "next_number", "padding", "separator",
  "year_reset", "month_reset", "day_reset", "active",
  "created_at", "updated_at"
)
SELECT gen_random_uuid(), 'ACCRUED_EXPENSE', 'Accrued Expense', 'AE', '{DOC}-{YEAR}-{SEQ}',
  1, 6, '-', true, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "number_series" WHERE "document_type" = 'ACCRUED_EXPENSE');

INSERT INTO "number_series" (
  "id", "document_type", "label", "doc_code", "template",
  "next_number", "padding", "separator",
  "year_reset", "month_reset", "day_reset", "active",
  "created_at", "updated_at"
)
SELECT gen_random_uuid(), 'FX_REVALUATION', 'FX Revaluation', 'FXR', '{DOC}-{YEAR}-{SEQ}',
  1, 6, '-', true, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "number_series" WHERE "document_type" = 'FX_REVALUATION');
