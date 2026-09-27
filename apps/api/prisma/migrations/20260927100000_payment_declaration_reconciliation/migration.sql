-- CreateEnum
CREATE TYPE "PaymentOrigin" AS ENUM ('LEGACY', 'SALES_DECLARATION', 'FINANCE_DECLARATION', 'LEAD_CONVERSION');

-- CreateEnum
CREATE TYPE "PaymentDeclarationKind" AS ENUM ('FULL', 'PARTIAL');

-- CreateEnum
CREATE TYPE "PaymentSettlementStatus" AS ENUM ('NOT_APPLICABLE', 'AWAITING_SETTLEMENT', 'PARTIALLY_SETTLED', 'SETTLED');

-- CreateEnum
CREATE TYPE "StoreOrderDeclaredPaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "PaymentStatementSourceType" AS ENUM ('FILE', 'GOOGLE_SHEET', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentStatementLineStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'EXCEPTION', 'IGNORED');

-- CreateEnum
CREATE TYPE "PaymentMatchStatus" AS ENUM ('ACTIVE', 'REVERSED');

-- CreateEnum
CREATE TYPE "PaymentSettlementDocStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "FxSyncRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'DISPUTED';

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_receiving_account_id_fkey";

-- AlterTable
ALTER TABLE "exchange_rates" ADD COLUMN     "buy_rate" DECIMAL(18,8),
ADD COLUMN     "sell_rate" DECIMAL(18,8),
ADD COLUMN     "source_timestamp" TIMESTAMP(3),
ADD COLUMN     "sync_run_id" UUID;

-- AlterTable
ALTER TABLE "financial_transactions" ADD COLUMN     "debit_account_id" UUID,
ADD COLUMN     "rate_as_of" DATE,
ADD COLUMN     "rate_source" TEXT;

-- AlterTable
ALTER TABLE "payment_methods" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "requires_reconciliation" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "declaration_kind" "PaymentDeclarationKind",
ADD COLUMN     "dispute_reason" TEXT,
ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "origin" "PaymentOrigin" NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "payment_method_id" UUID,
ADD COLUMN     "settled_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "settlement_status" "PaymentSettlementStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
ALTER COLUMN "receiving_account_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "store_orders" ADD COLUMN     "declared_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "declared_payment_status" "StoreOrderDeclaredPaymentStatus" NOT NULL DEFAULT 'UNPAID',
ADD COLUMN     "payment_discrepancy" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payment_discrepancy_reason" TEXT;

-- CreateTable
CREATE TABLE "payment_receipt_links" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "financial_transaction_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "payment_receipt_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_statement_imports" (
    "id" UUID NOT NULL,
    "payment_method_id" UUID NOT NULL,
    "source_type" "PaymentStatementSourceType" NOT NULL,
    "file_name" TEXT,
    "sheet_name" TEXT,
    "sync_source_id" UUID,
    "mapping" JSONB,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "created_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
    "exception_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "payment_statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_statement_lines" (
    "id" UUID NOT NULL,
    "payment_method_id" UUID NOT NULL,
    "import_id" UUID,
    "source_type" "PaymentStatementSourceType" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "provider_reference" TEXT,
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "customer_phone_e164" TEXT,
    "order_reference" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency_id" UUID NOT NULL,
    "transaction_date" DATE NOT NULL,
    "provider_status" TEXT,
    "fee_amount" DECIMAL(12,2),
    "net_amount" DECIMAL(12,2),
    "sheet_name" TEXT,
    "row_number" INTEGER,
    "raw_row" JSONB,
    "row_hash" TEXT,
    "status" "PaymentStatementLineStatus" NOT NULL DEFAULT 'UNMATCHED',
    "exception_reason" TEXT,
    "matched_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "payment_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_matches" (
    "id" UUID NOT NULL,
    "statement_line_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PaymentMatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "reasons" JSONB,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_by" UUID,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" UUID,
    "reversal_reason" TEXT,

    CONSTRAINT "payment_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_settlements" (
    "id" UUID NOT NULL,
    "settlement_number" TEXT NOT NULL,
    "payment_method_id" UUID NOT NULL,
    "receiving_account_id" UUID NOT NULL,
    "settlement_date" DATE NOT NULL,
    "provider_reference" TEXT,
    "currency_id" UUID NOT NULL,
    "gross_amount" DECIMAL(12,2) NOT NULL,
    "received_currency_id" UUID NOT NULL,
    "received_amount" DECIMAL(12,2) NOT NULL,
    "fee_amount" DECIMAL(12,2) NOT NULL,
    "conversion_basis" JSONB,
    "fx_difference" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "PaymentSettlementDocStatus" NOT NULL DEFAULT 'POSTED',
    "idempotency_key" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" UUID,

    CONSTRAINT "payment_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_settlement_lines" (
    "id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "carrying_amount_functional" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "payment_settlement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rate_overrides" (
    "id" UUID NOT NULL,
    "from_currency_id" UUID NOT NULL,
    "to_currency_id" UUID NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "date_from" DATE NOT NULL,
    "date_to" DATE NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,

    CONSTRAINT "exchange_rate_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_sync_settings" (
    "id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "provider" TEXT NOT NULL DEFAULT 'CBE',
    "currency_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rate_basis" TEXT NOT NULL DEFAULT 'MID',
    "max_stale_days" INTEGER NOT NULL DEFAULT 10,
    "stale_alert_days" INTEGER NOT NULL DEFAULT 4,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "fx_sync_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_sync_runs" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'CRON',
    "status" "FxSyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "source_timestamp" TIMESTAMP(3),
    "effective_date" DATE,
    "fetched_count" INTEGER NOT NULL DEFAULT 0,
    "inserted_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "details" JSONB,
    "created_by" UUID,

    CONSTRAINT "fx_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipt_links_payment_id_key" ON "payment_receipt_links"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipt_links_financial_transaction_id_key" ON "payment_receipt_links"("financial_transaction_id");

-- CreateIndex
CREATE INDEX "payment_statement_imports_payment_method_id_created_at_idx" ON "payment_statement_imports"("payment_method_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_statement_lines_payment_method_id_status_idx" ON "payment_statement_lines"("payment_method_id", "status");

-- CreateIndex
CREATE INDEX "payment_statement_lines_customer_phone_e164_idx" ON "payment_statement_lines"("customer_phone_e164");

-- CreateIndex
CREATE INDEX "payment_statement_lines_order_reference_idx" ON "payment_statement_lines"("order_reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_statement_lines_payment_method_id_dedupe_key_key" ON "payment_statement_lines"("payment_method_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "payment_matches_payment_id_status_idx" ON "payment_matches"("payment_id", "status");

-- CreateIndex
CREATE INDEX "payment_matches_statement_line_id_status_idx" ON "payment_matches"("statement_line_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_settlements_settlement_number_key" ON "payment_settlements"("settlement_number");

-- CreateIndex
CREATE UNIQUE INDEX "payment_settlements_idempotency_key_key" ON "payment_settlements"("idempotency_key");

-- CreateIndex
CREATE INDEX "payment_settlements_payment_method_id_settlement_date_idx" ON "payment_settlements"("payment_method_id", "settlement_date");

-- CreateIndex
CREATE INDEX "payment_settlement_lines_payment_id_idx" ON "payment_settlement_lines"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_settlement_lines_settlement_id_payment_id_key" ON "payment_settlement_lines"("settlement_id", "payment_id");

-- CreateIndex
CREATE INDEX "exchange_rate_overrides_from_currency_id_to_currency_id_dat_idx" ON "exchange_rate_overrides"("from_currency_id", "to_currency_id", "date_from");

-- CreateIndex
CREATE INDEX "fx_sync_runs_started_at_idx" ON "fx_sync_runs"("started_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_payment_method_id_settlement_status_idx" ON "payments"("payment_method_id", "settlement_status");

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "fx_sync_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_receiving_account_id_fkey" FOREIGN KEY ("receiving_account_id") REFERENCES "receiving_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_receipt_links" ADD CONSTRAINT "payment_receipt_links_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_receipt_links" ADD CONSTRAINT "payment_receipt_links_financial_transaction_id_fkey" FOREIGN KEY ("financial_transaction_id") REFERENCES "financial_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_statement_imports" ADD CONSTRAINT "payment_statement_imports_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_statement_lines" ADD CONSTRAINT "payment_statement_lines_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_statement_lines" ADD CONSTRAINT "payment_statement_lines_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "payment_statement_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_statement_lines" ADD CONSTRAINT "payment_statement_lines_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_statement_line_id_fkey" FOREIGN KEY ("statement_line_id") REFERENCES "payment_statement_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_matches" ADD CONSTRAINT "payment_matches_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_receiving_account_id_fkey" FOREIGN KEY ("receiving_account_id") REFERENCES "receiving_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_received_currency_id_fkey" FOREIGN KEY ("received_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_settlement_lines" ADD CONSTRAINT "payment_settlement_lines_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "payment_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_settlement_lines" ADD CONSTRAINT "payment_settlement_lines_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rate_overrides" ADD CONSTRAINT "exchange_rate_overrides_from_currency_id_fkey" FOREIGN KEY ("from_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rate_overrides" ADD CONSTRAINT "exchange_rate_overrides_to_currency_id_fkey" FOREIGN KEY ("to_currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_debit_account_id_fkey" FOREIGN KEY ("debit_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written guards (not expressible in Prisma schema)
-- ---------------------------------------------------------------------------

-- Manual FX overrides: inclusive date ranges per currency pair must never overlap
-- (enforced by the database, so concurrent inserts cannot both succeed).
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "exchange_rate_overrides"
  ADD CONSTRAINT "exchange_rate_overrides_valid_range" CHECK ("date_to" >= "date_from"),
  ADD CONSTRAINT "exchange_rate_overrides_positive_rate" CHECK ("rate" > 0),
  ADD CONSTRAINT "exchange_rate_overrides_distinct_pair" CHECK ("from_currency_id" <> "to_currency_id");

ALTER TABLE "exchange_rate_overrides"
  ADD CONSTRAINT "exchange_rate_overrides_no_overlap"
  EXCLUDE USING gist (
    "from_currency_id" WITH =,
    "to_currency_id" WITH =,
    daterange("date_from", "date_to", '[]') WITH &&
  ) WHERE ("deleted_at" IS NULL);

-- Allocation and settlement can never exceed the underlying amounts.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_settled_amount_bounds" CHECK ("settled_amount" >= 0 AND "settled_amount" <= "amount");

ALTER TABLE "payment_statement_lines"
  ADD CONSTRAINT "payment_statement_lines_matched_bounds" CHECK ("matched_amount" >= 0 AND "matched_amount" <= "amount"),
  ADD CONSTRAINT "payment_statement_lines_positive_amount" CHECK ("amount" > 0);

ALTER TABLE "payment_matches"
  ADD CONSTRAINT "payment_matches_positive_amount" CHECK ("amount" > 0);

ALTER TABLE "payment_settlement_lines"
  ADD CONSTRAINT "payment_settlement_lines_positive_amount" CHECK ("amount" > 0);

ALTER TABLE "payment_settlements"
  ADD CONSTRAINT "payment_settlements_amounts" CHECK ("gross_amount" > 0 AND "received_amount" >= 0 AND "fee_amount" >= 0);

ALTER TABLE "store_orders"
  ADD CONSTRAINT "store_orders_declared_amount_nonnegative" CHECK ("declared_amount" >= 0);

-- Singleton automatic-FX settings row (enabled by default, CBE, derived mid, 10-day staleness).
INSERT INTO "fx_sync_settings" ("id", "enabled", "provider", "currency_codes", "rate_basis", "max_stale_days", "stale_alert_days", "updated_at")
SELECT gen_random_uuid(), true, 'CBE', ARRAY[]::TEXT[], 'MID', 10, 4, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "fx_sync_settings");
