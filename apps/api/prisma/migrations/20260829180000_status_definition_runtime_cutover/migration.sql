-- Runtime StatusDefinition cutover for Payment / Fulfillment / Matching.
-- Seed missing codes, add FKs, backfill from legacy enums (dual-write era).

-- PAYMENT: OVERPAID + UNMATCHED (order reconciliation states)
INSERT INTO "status_definitions" ("id", "workflow_type", "code", "name", "name_en", "color", "sort_order", "is_system", "is_final", "is_default", "updated_at")
SELECT gen_random_uuid(), 'PAYMENT', 'OVERPAID', 'مدفوع زيادة', 'Overpaid', 'warning', 6, true, false, false, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "status_definitions" WHERE "workflow_type" = 'PAYMENT' AND "code" = 'OVERPAID' AND "deleted_at" IS NULL);

INSERT INTO "status_definitions" ("id", "workflow_type", "code", "name", "name_en", "color", "sort_order", "is_system", "is_final", "is_default", "updated_at")
SELECT gen_random_uuid(), 'PAYMENT', 'UNMATCHED', 'غير مطابق', 'Unmatched', 'warning', 7, true, false, false, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "status_definitions" WHERE "workflow_type" = 'PAYMENT' AND "code" = 'UNMATCHED' AND "deleted_at" IS NULL);

-- MATCHING: align catalog codes 1:1 with BankTransactionMatchStatus
INSERT INTO "status_definitions" ("id", "workflow_type", "code", "name", "name_en", "color", "sort_order", "is_system", "is_final", "is_default", "updated_at")
SELECT gen_random_uuid(), 'MATCHING', v.code, v.name, v.name_en, v.color, v.sort_order, true, v.is_final, v.is_default, CURRENT_TIMESTAMP
FROM (VALUES
  ('POTENTIAL', 'مطابقة محتملة', 'Potential', 'warning', 1, false, false),
  ('PARTIALLY_MATCHED', 'مطابق جزئياً', 'Partially Matched', 'warning', 2, false, false),
  ('DUPLICATE', 'مكرر', 'Duplicate', 'neutral', 5, true, false),
  ('CONFLICT', 'تعارض', 'Conflict', 'destructive', 6, false, false),
  ('MANUAL_REVIEW', 'مراجعة يدوية', 'Manual Review', 'warning', 7, false, false)
) AS v(code, name, name_en, color, sort_order, is_final, is_default)
WHERE NOT EXISTS (
  SELECT 1 FROM "status_definitions" s
  WHERE s."workflow_type" = 'MATCHING' AND s."code" = v.code AND s."deleted_at" IS NULL
);

-- Soft-retire obsolete MATCHING codes that diverged from the enum
UPDATE "status_definitions"
SET "deleted_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
WHERE "workflow_type" = 'MATCHING'
  AND "code" IN ('CANDIDATE', 'REVIEW')
  AND "deleted_at" IS NULL;

-- Store Order FKs
ALTER TABLE "store_orders" ADD COLUMN IF NOT EXISTS "payment_status_id" UUID;
ALTER TABLE "store_orders" ADD COLUMN IF NOT EXISTS "fulfillment_status_id" UUID;

-- Bank Transaction FK
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "match_status_id" UUID;

-- Backfill payment_status_id
UPDATE "store_orders" so
SET "payment_status_id" = sd."id"
FROM "status_definitions" sd
WHERE sd."workflow_type" = 'PAYMENT'
  AND sd."deleted_at" IS NULL
  AND so."payment_status_id" IS NULL
  AND (
    (so."payment_status" = 'PAYMENT_PENDING' AND sd."code" = 'UNPAID')
    OR (so."payment_status" = 'PAYMENT_REVIEW' AND sd."code" = 'PAYMENT_REPORTED')
    OR (so."payment_status" = 'PARTIALLY_PAID' AND sd."code" = 'PARTIALLY_PAID')
    OR (so."payment_status" = 'FULLY_PAID_RECONCILED' AND sd."code" = 'PAID')
    OR (so."payment_status" = 'OVERPAID' AND sd."code" = 'OVERPAID')
    OR (so."payment_status" = 'UNMATCHED' AND sd."code" = 'UNMATCHED')
  );

-- Backfill fulfillment_status_id from shipping_stage
UPDATE "store_orders" so
SET "fulfillment_status_id" = sd."id"
FROM "status_definitions" sd
WHERE sd."workflow_type" = 'FULFILLMENT'
  AND sd."deleted_at" IS NULL
  AND so."fulfillment_status_id" IS NULL
  AND (
    (so."shipping_stage" = 'NOT_READY' AND sd."code" = 'UNFULFILLED')
    OR (so."shipping_stage" = 'READY_FOR_SHIPPING' AND sd."code" = 'READY')
  );

-- Backfill match_status_id
UPDATE "bank_transactions" bt
SET "match_status_id" = sd."id"
FROM "status_definitions" sd
WHERE sd."workflow_type" = 'MATCHING'
  AND sd."deleted_at" IS NULL
  AND bt."match_status_id" IS NULL
  AND sd."code" = bt."match_status"::text;

-- FKs + indexes
DO $$ BEGIN
  ALTER TABLE "store_orders"
    ADD CONSTRAINT "store_orders_payment_status_id_fkey"
    FOREIGN KEY ("payment_status_id") REFERENCES "status_definitions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "store_orders"
    ADD CONSTRAINT "store_orders_fulfillment_status_id_fkey"
    FOREIGN KEY ("fulfillment_status_id") REFERENCES "status_definitions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bank_transactions"
    ADD CONSTRAINT "bank_transactions_match_status_id_fkey"
    FOREIGN KEY ("match_status_id") REFERENCES "status_definitions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "store_orders_payment_status_id_idx" ON "store_orders"("payment_status_id");
CREATE INDEX IF NOT EXISTS "store_orders_fulfillment_status_id_idx" ON "store_orders"("fulfillment_status_id");
CREATE INDEX IF NOT EXISTS "bank_transactions_match_status_id_idx" ON "bank_transactions"("match_status_id");
