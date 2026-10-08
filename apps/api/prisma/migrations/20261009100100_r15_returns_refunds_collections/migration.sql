-- R15 (decisions D15-9 … D15-12) — collections, returns and refunds of store
-- orders.
--
-- * sales_returns.store_order_id / reason, sales_return_items.condition
--   (SALEABLE → stock, DAMAGED → damaged-goods warehouse) — the order-linked
--   return workflow; recognition states RETURNED / PARTIALLY_RETURNED.
-- * financial_transaction_allocations.store_order_id — a CUSTOMER_REFUND of an
--   order's verified, not-invoiced advance (cancelled / undelivered / overpaid).
-- * payments: REVERSED status + reversal audit columns (erroneous verified
--   payment reversed, never deleted); origin CARRIER_COD (expected COD claim).
-- * shipping_companies.cod_payment_method_id — the method (clearing account =
--   receivable from the carrier) for cash a carrier collects on delivery.
-- * permission sales.receipts.reverse — granted to every INTERNAL holder of
--   sales.receipts.cancel (the people who may already cancel a receipt).
--
-- Enum values are only added here (never used in this migration). Additive.
-- Reverse with: drop the added columns / index / FKs, DELETE the permission
-- (enum values stay; unused).

-- AlterEnum
ALTER TYPE "PaymentOrigin" ADD VALUE 'CARRIER_COD';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'REVERSED';

-- AlterEnum
ALTER TYPE "StoreOrderRecognitionStatus" ADD VALUE 'RETURNED';
ALTER TYPE "StoreOrderRecognitionStatus" ADD VALUE 'PARTIALLY_RETURNED';

-- CreateEnum
CREATE TYPE "ReturnItemCondition" AS ENUM ('SALEABLE', 'DAMAGED');

-- AlterTable
ALTER TABLE "sales_returns" ADD COLUMN "reason" TEXT,
ADD COLUMN "store_order_id" UUID;

-- CreateIndex
CREATE INDEX "sales_returns_store_order_id_idx" ON "sales_returns"("store_order_id");

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_store_order_id_fkey" FOREIGN KEY ("store_order_id") REFERENCES "store_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing returns of store-order invoices are linked to their order.
UPDATE "sales_returns" sr
SET "store_order_id" = si."store_order_id"
FROM "sales_invoices" si
WHERE sr."sales_invoice_id" = si."id" AND si."store_order_id" IS NOT NULL AND sr."store_order_id" IS NULL;

-- AlterTable
ALTER TABLE "sales_return_items" ADD COLUMN "condition" "ReturnItemCondition" NOT NULL DEFAULT 'SALEABLE';

-- AlterTable
ALTER TABLE "financial_transaction_allocations" ADD COLUMN "store_order_id" UUID;

-- CreateIndex
CREATE INDEX "financial_transaction_allocations_store_order_id_idx" ON "financial_transaction_allocations"("store_order_id");

-- AddForeignKey
ALTER TABLE "financial_transaction_allocations" ADD CONSTRAINT "financial_transaction_allocations_store_order_id_fkey" FOREIGN KEY ("store_order_id") REFERENCES "store_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "reversal_reason" TEXT,
ADD COLUMN "reversed_at" TIMESTAMP(3),
ADD COLUMN "reversed_by_id" UUID;

-- AlterTable
ALTER TABLE "shipping_companies" ADD COLUMN "cod_payment_method_id" UUID;

-- AddForeignKey
ALTER TABLE "shipping_companies" ADD CONSTRAINT "shipping_companies_cod_payment_method_id_fkey" FOREIGN KEY ("cod_payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permission (catalog module `customer-receipts`).
INSERT INTO "permissions" ("id", "name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), 'sales.receipts.reverse', 'Permission Matrix: sales.receipts.reverse', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."name" = 'sales.receipts.reverse');

INSERT INTO "user_permissions" ("id", "user_id", "permission_id", "created_at", "effect")
SELECT gen_random_uuid(), u."id", target."id", CURRENT_TIMESTAMP, 'GRANT'
FROM "users" u
CROSS JOIN (SELECT "id" FROM "permissions" WHERE "name" = 'sales.receipts.reverse') target
WHERE u."user_type" = 'INTERNAL'
  AND EXISTS (
    SELECT 1 FROM "user_permissions" held
    JOIN "permissions" hp ON hp."id" = held."permission_id"
    WHERE held."user_id" = u."id" AND held."effect" = 'GRANT'
      AND hp."name" = 'sales.receipts.cancel'
  )
ON CONFLICT ("user_id", "permission_id") DO NOTHING;
