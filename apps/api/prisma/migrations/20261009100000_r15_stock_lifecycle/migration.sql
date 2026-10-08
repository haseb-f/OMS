-- R15 (decisions D15-1 … D15-8) — store-order stock lifecycle:
-- reservation at creation, dispatch to a goods-in-transit warehouse, delivery
-- (partial shipments / acceptance) out of transit, goods received back.
--
-- * warehouses.role (STOCK / TRANSIT / DAMAGED) + the two system warehouses
--   WH-TRANSIT («بضاعة في الطريق») and WH-DAMAGED («بضاعة تالفة / مرتجعات تالفة»),
--   created only when no warehouse of that role exists.
-- * store_orders.stock_status / stock_issue / stock_status_at (summary of the
--   reservation / transit / delivery movements; ledger stays the truth).
--   Existing orders start PENDING until the R15 backfill evaluates them.
-- * shipment_lines (quantities per shipment attempt) and
--   sales_invoices.shipment_id (one invoice per delivered shipment).
--
-- Additive. Reverse with: DROP TABLE shipment_lines; ALTER TABLE sales_invoices
-- DROP COLUMN shipment_id; ALTER TABLE store_orders DROP COLUMN stock_status,
-- DROP COLUMN stock_issue, DROP COLUMN stock_status_at; DELETE the two system
-- warehouses if no movement references them; ALTER TABLE warehouses DROP COLUMN
-- role; DROP TYPE "WarehouseRole", "StoreOrderStockStatus"; DELETE the permission.

-- CreateEnum
CREATE TYPE "WarehouseRole" AS ENUM ('STOCK', 'TRANSIT', 'DAMAGED');

-- CreateEnum
CREATE TYPE "StoreOrderStockStatus" AS ENUM ('PENDING', 'NOT_REQUIRED', 'RESERVED', 'SHORT', 'IN_TRANSIT', 'PARTIALLY_DELIVERED', 'DELIVERED', 'RETURNING', 'RETURNED', 'RELEASED');

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN "role" "WarehouseRole" NOT NULL DEFAULT 'STOCK';

-- CreateIndex
CREATE INDEX "warehouses_role_idx" ON "warehouses"("role");

-- AlterTable
ALTER TABLE "store_orders" ADD COLUMN "stock_issue" JSONB,
ADD COLUMN "stock_status" "StoreOrderStockStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "stock_status_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "store_orders_stock_status_created_at_idx" ON "store_orders"("stock_status", "created_at");

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN "shipment_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_shipment_id_key" ON "sales_invoices"("shipment_id");

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "shipment_lines" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "store_order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "delivered_quantity" INTEGER NOT NULL DEFAULT 0,
    "returned_quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "shipment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipment_lines_store_order_item_id_idx" ON "shipment_lines"("store_order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_lines_shipment_id_store_order_item_id_key" ON "shipment_lines"("shipment_id", "store_order_item_id");

-- AddForeignKey
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_store_order_item_id_fkey" FOREIGN KEY ("store_order_item_id") REFERENCES "store_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- System warehouses (never typed by users; codes are fixed so every
-- environment has the same identity). Created only when the role is missing.
INSERT INTO "warehouses" ("id", "code", "name", "description", "is_default", "warehouse_type", "role", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), 'WH-TRANSIT', 'بضاعة في الطريق — Goods in transit',
       'System warehouse: goods dispatched to the carrier and not yet delivered (still company / agent inventory).',
       false, 'SYSTEM', 'TRANSIT', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "warehouses" w WHERE w."role" = 'TRANSIT')
  AND NOT EXISTS (SELECT 1 FROM "warehouses" w WHERE w."code" = 'WH-TRANSIT');

INSERT INTO "warehouses" ("id", "code", "name", "description", "is_default", "warehouse_type", "role", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), 'WH-DAMAGED', 'بضاعة تالفة — Damaged goods',
       'System warehouse: returned goods that failed inspection (not available to sell).',
       false, 'SYSTEM', 'DAMAGED', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "warehouses" w WHERE w."role" = 'DAMAGED')
  AND NOT EXISTS (SELECT 1 FROM "warehouses" w WHERE w."code" = 'WH-DAMAGED');

-- A pre-existing warehouse already using one of the fixed codes takes the role.
UPDATE "warehouses" SET "role" = 'TRANSIT'
WHERE "code" = 'WH-TRANSIT' AND NOT EXISTS (SELECT 1 FROM "warehouses" w WHERE w."role" = 'TRANSIT');
UPDATE "warehouses" SET "role" = 'DAMAGED'
WHERE "code" = 'WH-DAMAGED' AND NOT EXISTS (SELECT 1 FROM "warehouses" w WHERE w."role" = 'DAMAGED');

-- Permission (catalog module `shipping`): receive goods that came back
-- undelivered. Every INTERNAL holder of shipping.edit / shipping.manage gets it
-- (the people who record failed deliveries today).
INSERT INTO "permissions" ("id", "name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), 'shipping.receive_returns', 'Permission Matrix: shipping.receive_returns', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."name" = 'shipping.receive_returns');

INSERT INTO "user_permissions" ("id", "user_id", "permission_id", "created_at", "effect")
SELECT gen_random_uuid(), u."id", target."id", CURRENT_TIMESTAMP, 'GRANT'
FROM "users" u
CROSS JOIN (SELECT "id" FROM "permissions" WHERE "name" = 'shipping.receive_returns') target
WHERE u."user_type" = 'INTERNAL'
  AND EXISTS (
    SELECT 1 FROM "user_permissions" held
    JOIN "permissions" hp ON hp."id" = held."permission_id"
    WHERE held."user_id" = u."id" AND held."effect" = 'GRANT'
      AND hp."name" IN ('shipping.edit', 'shipping.manage')
  )
ON CONFLICT ("user_id", "permission_id") DO NOTHING;
