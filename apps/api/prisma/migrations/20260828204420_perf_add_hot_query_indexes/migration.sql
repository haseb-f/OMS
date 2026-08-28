-- DropIndex
DROP INDEX "store_orders_external_order_id_idx";

-- CreateIndex
CREATE INDEX "customers_deleted_at_name_idx" ON "customers"("deleted_at", "name");

-- CreateIndex
CREATE INDEX "products_deleted_at_created_at_idx" ON "products"("deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "products_brand_id_idx" ON "products"("brand_id");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- CreateIndex
CREATE INDEX "shipments_status_created_at_idx" ON "shipments"("status", "created_at");

-- CreateIndex
CREATE INDEX "shipments_shipping_company_id_idx" ON "shipments"("shipping_company_id");

-- CreateIndex
CREATE INDEX "shipments_deleted_at_created_at_idx" ON "shipments"("deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "store_orders_deleted_at_created_at_idx" ON "store_orders"("deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "store_orders_payment_status_created_at_idx" ON "store_orders"("payment_status", "created_at");

-- CreateIndex
CREATE INDEX "store_orders_shipping_stage_created_at_idx" ON "store_orders"("shipping_stage", "created_at");

-- CreateIndex
CREATE INDEX "store_orders_order_date_idx" ON "store_orders"("order_date");
