-- R22 A3 — `allocation_date` is the day an allocation took effect: the lines
-- a voucher carried when it was posted settle on the day its entry was booked
-- (`confirmed_at` for every voucher posted before R22 D1; from R22 Confirm
-- stamps the voucher date), a later Allocate keeps its own date. Allocations
-- saved on a draft kept the draft's creation time, earlier than the posting;
-- bring them to the posting date so as-of aging agrees with the ledger.
-- Additive (no schema change), idempotent (a re-run matches no row), touches
-- no journal entry, amount or status.
UPDATE "financial_transaction_allocations" AS a
SET "allocation_date" = t."confirmed_at"
FROM "financial_transactions" AS t
WHERE a."transaction_id" = t."id"
  AND t."status" = 'CONFIRMED'
  AND t."confirmed_at" IS NOT NULL
  AND a."allocation_date" < t."confirmed_at";

-- As-of readers filter allocations by invoice and date.
CREATE INDEX IF NOT EXISTS "financial_transaction_allocations_sales_invoice_id_idx"
  ON "financial_transaction_allocations" ("sales_invoice_id");
CREATE INDEX IF NOT EXISTS "financial_transaction_allocations_purchase_invoice_id_idx"
  ON "financial_transaction_allocations" ("purchase_invoice_id");
