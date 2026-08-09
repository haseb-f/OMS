-- TASK-038: Customer switches to the shared MasterDataActivityLog pattern
-- (already used by 16+ Master Data entities) instead of a dedicated
-- customer_activities table.

-- DropTable (CASCADE also drops its FK to customers)
DROP TABLE IF EXISTS "customer_activities" CASCADE;

-- CreateIndex — used by CustomersService.create()'s "prevent duplicate by
-- phone/email" lookup.
CREATE INDEX "customers_phone_idx" ON "customers"("phone");
CREATE INDEX "customers_email_idx" ON "customers"("email");
