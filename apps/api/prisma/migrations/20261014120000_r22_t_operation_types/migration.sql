-- R22 stream T (decision D4) — receipt / payment operation types on the
-- existing FinancialTransaction voucher. Additive and idempotent only: three
-- enum values, two nullable voucher columns, one nullable allocation column
-- (each with its FK + index) and three number series. No existing row,
-- column, counter or grant is changed (authorisation reuses the manual
-- journal-entry permissions; nothing is granted here).

ALTER TYPE "FinancialTransactionType" ADD VALUE IF NOT EXISTS 'OTHER_RECEIPT';
ALTER TYPE "FinancialTransactionType" ADD VALUE IF NOT EXISTS 'OTHER_PAYMENT';
ALTER TYPE "FinancialTransactionType" ADD VALUE IF NOT EXISTS 'INTERNAL_TRANSFER';

-- OTHER_RECEIPT / OTHER_PAYMENT: the authorised counter-account.
ALTER TABLE "financial_transactions"
  ADD COLUMN IF NOT EXISTS "counter_account_id" UUID;

-- INTERNAL_TRANSFER: the destination cash / bank account (receiving_account_id = source).
ALTER TABLE "financial_transactions"
  ADD COLUMN IF NOT EXISTS "target_receiving_account_id" UUID;

-- Refund of an unapplied customer receipt (refund line target / the receipt's consumption row).
ALTER TABLE "financial_transaction_allocations"
  ADD COLUMN IF NOT EXISTS "receipt_id" UUID;

DO $$ BEGIN
  ALTER TABLE "financial_transactions"
    ADD CONSTRAINT "financial_transactions_counter_account_id_fkey"
    FOREIGN KEY ("counter_account_id") REFERENCES "chart_of_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "financial_transactions"
    ADD CONSTRAINT "financial_transactions_target_receiving_account_id_fkey"
    FOREIGN KEY ("target_receiving_account_id") REFERENCES "receiving_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "financial_transaction_allocations"
    ADD CONSTRAINT "financial_transaction_allocations_receipt_id_fkey"
    FOREIGN KEY ("receipt_id") REFERENCES "financial_transactions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "financial_transaction_allocations_receipt_id_idx"
  ON "financial_transaction_allocations"("receipt_id");

-- Numbering Engine series (OR- / OP- / TR-), same shape as every voucher series.
INSERT INTO "number_series" (
  "id", "document_type", "label", "doc_code", "template",
  "next_number", "padding", "separator",
  "year_reset", "month_reset", "day_reset", "active",
  "created_at", "updated_at"
)
VALUES
  (gen_random_uuid(), 'OTHER_RECEIPT', 'Other Receipt', 'OR',
   '{DOC}-{YEAR}-{SEQ}', 1, 6, '-', true, false, false, true,
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'OTHER_PAYMENT', 'Other Payment', 'OP',
   '{DOC}-{YEAR}-{SEQ}', 1, 6, '-', true, false, false, true,
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'INTERNAL_TRANSFER', 'Internal Transfer', 'TR',
   '{DOC}-{YEAR}-{SEQ}', 1, 6, '-', true, false, false, true,
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("document_type") DO NOTHING;
