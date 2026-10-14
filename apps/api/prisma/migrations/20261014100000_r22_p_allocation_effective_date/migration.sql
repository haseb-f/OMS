-- R22 stream P (A3 / F5 / F6 / F9) — allocation effective dates and the
-- append-only allocation history read by as-of aging.
--
-- Additive: one new table + indexes; existing rows only get a derived date
-- (`allocation_date`), never an amount, status or journal entry.
-- Idempotent: a row counts as migrated once it has an allocation event, so
-- both data statements below only touch allocations WITHOUT an event; a
-- re-run (or a database where the application already wrote events since
-- R22) matches nothing it already handled. Independent of the R22-T
-- migration (20261014120000): it reads no column T adds.

CREATE TABLE IF NOT EXISTS "financial_transaction_allocation_events" (
  "id" UUID NOT NULL,
  "allocation_id" UUID NOT NULL,
  "transaction_id" UUID NOT NULL,
  "sales_invoice_id" UUID,
  "purchase_invoice_id" UUID,
  "sales_return_id" UUID,
  "store_order_id" UUID,
  "event_type" TEXT NOT NULL,
  "amount_delta" DECIMAL(12, 2) NOT NULL,
  "effective_date" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  CONSTRAINT "financial_transaction_allocation_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "financial_transaction_allocation_events_transaction_id_idx"
  ON "financial_transaction_allocation_events" ("transaction_id");
CREATE INDEX IF NOT EXISTS "financial_transaction_allocation_events_allocation_id_idx"
  ON "financial_transaction_allocation_events" ("allocation_id");
CREATE INDEX IF NOT EXISTS "financial_transaction_allocation_events_sales_invoice_id_idx"
  ON "financial_transaction_allocation_events" ("sales_invoice_id");
CREATE INDEX IF NOT EXISTS "financial_transaction_allocation_events_purchase_invoice_id_idx"
  ON "financial_transaction_allocation_events" ("purchase_invoice_id");
CREATE INDEX IF NOT EXISTS "financial_transaction_allocation_events_sales_return_id_idx"
  ON "financial_transaction_allocation_events" ("sales_return_id");

-- Current-state readers filter allocations by invoice.
CREATE INDEX IF NOT EXISTS "financial_transaction_allocations_sales_invoice_id_idx"
  ON "financial_transaction_allocations" ("sales_invoice_id");
CREATE INDEX IF NOT EXISTS "financial_transaction_allocations_purchase_invoice_id_idx"
  ON "financial_transaction_allocations" ("purchase_invoice_id");

-- 1. Effective date of the lines a CONFIRMED voucher carried when it was
--    posted (saved on its draft, earlier than the posting): the date of the
--    voucher's posted entry (its original, non-reversal entry), else its
--    `confirmed_at`. Lines allocated after posting keep their own date.
UPDATE "financial_transaction_allocations" AS a
SET "allocation_date" = COALESCE(
  (
    SELECT MIN(je."entry_date")
    FROM "journal_entries" AS je
    WHERE je."source_id" = t."id"
      AND je."source_type" = t."type"::text
      AND je."reversal_of_entry_id" IS NULL
      AND je."deleted_at" IS NULL
  ),
  t."confirmed_at"
)
FROM "financial_transactions" AS t
WHERE a."transaction_id" = t."id"
  AND t."status" = 'CONFIRMED'
  AND t."confirmed_at" IS NOT NULL
  AND a."allocation_date" < t."confirmed_at"
  AND NOT EXISTS (
    SELECT 1 FROM "financial_transaction_allocation_events" AS e
    WHERE e."allocation_id" = a."id"
  );

-- 2. The history of every current line of a CONFIRMED voucher: one CREATED
--    event for its amount, effective on max(its date, its invoice's posting
--    date) (F6). Lines of cancelled vouchers no longer exist (cancel deleted
--    them); those vouchers keep counting as unapplied until their cancel day.
INSERT INTO "financial_transaction_allocation_events" (
  "id", "allocation_id", "transaction_id", "sales_invoice_id",
  "purchase_invoice_id", "sales_return_id", "store_order_id", "event_type",
  "amount_delta", "effective_date", "created_by"
)
SELECT
  gen_random_uuid(), a."id", a."transaction_id", a."sales_invoice_id",
  a."purchase_invoice_id", a."sales_return_id", a."store_order_id", 'CREATED',
  a."allocated_amount",
  GREATEST(
    a."allocation_date",
    COALESCE(si."confirmed_at", si."created_at", a."allocation_date"),
    COALESCE(pi."confirmed_at", pi."created_at", a."allocation_date")
  ),
  a."created_by"
FROM "financial_transaction_allocations" AS a
JOIN "financial_transactions" AS t ON t."id" = a."transaction_id"
LEFT JOIN "sales_invoices" AS si ON si."id" = a."sales_invoice_id"
LEFT JOIN "purchase_invoices" AS pi ON pi."id" = a."purchase_invoice_id"
WHERE t."status" = 'CONFIRMED'
  AND NOT EXISTS (
    SELECT 1 FROM "financial_transaction_allocation_events" AS e
    WHERE e."allocation_id" = a."id"
  );
