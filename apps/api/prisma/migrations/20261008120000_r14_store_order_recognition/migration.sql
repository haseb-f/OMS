-- R14 W3 (spec-3 §3): company store-order recognition state.
-- Additive only: a new enum, three nullable/defaulted columns and one index.
-- Existing rows start NOT_DUE; the recognition repair script
-- (prisma/scripts/r14-recognition-repair.ts) recognises delivered orders.

-- CreateEnum
CREATE TYPE "StoreOrderRecognitionStatus" AS ENUM ('NOT_DUE', 'RESERVED', 'RECOGNIZED', 'FAILED', 'RETURN_PENDING');

-- AlterTable
ALTER TABLE "store_orders"
  ADD COLUMN "recognition_status" "StoreOrderRecognitionStatus" NOT NULL DEFAULT 'NOT_DUE',
  ADD COLUMN "recognition_error" JSONB,
  ADD COLUMN "recognition_attempted_at" TIMESTAMP(3);

-- Orders that already carry a live company sales invoice are recognised.
UPDATE "store_orders" so
SET "recognition_status" = 'RECOGNIZED'
WHERE so."agent_id" IS NULL
  AND EXISTS (
    SELECT 1 FROM "sales_invoices" si
    WHERE si."store_order_id" = so."id"
      AND si."deleted_at" IS NULL
      AND si."status" <> 'CANCELLED'
  );

-- CreateIndex
CREATE INDEX "store_orders_recognition_status_idx" ON "store_orders"("recognition_status");
