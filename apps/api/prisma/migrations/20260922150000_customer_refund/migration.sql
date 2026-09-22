-- Customer Refund (CUSTOMER_REFUND) — pays a customer back against the
-- unrefunded credit of a posted Sales Return. Additive only: a new enum
-- value, a nullable allocation FK to sales_returns, and the CRF number
-- series. No existing row, column, or counter is changed.

ALTER TYPE "FinancialTransactionType" ADD VALUE IF NOT EXISTS 'CUSTOMER_REFUND';

ALTER TABLE "financial_transaction_allocations"
  ADD COLUMN IF NOT EXISTS "sales_return_id" UUID;

DO $$ BEGIN
  ALTER TABLE "financial_transaction_allocations"
    ADD CONSTRAINT "financial_transaction_allocations_sales_return_id_fkey"
    FOREIGN KEY ("sales_return_id") REFERENCES "sales_returns"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "financial_transaction_allocations_sales_return_id_idx"
  ON "financial_transaction_allocations"("sales_return_id");

INSERT INTO "number_series" (
  "id", "document_type", "label", "doc_code", "template",
  "next_number", "padding", "separator",
  "year_reset", "month_reset", "day_reset", "active",
  "created_at", "updated_at"
)
VALUES (
  gen_random_uuid(), 'CUSTOMER_REFUND', 'Customer Refund', 'CRF',
  '{DOC}-{YEAR}-{SEQ}', 1, 6, '-', true, false, false, true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("document_type") DO NOTHING;
