-- CreateIndex
CREATE INDEX "journal_entry_lines_account_id_idx" ON "journal_entry_lines"("account_id");

-- CreateIndex
CREATE INDEX "payments_lead_id_idx" ON "payments"("lead_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "sales_order_activities_sales_order_id_idx" ON "sales_order_activities"("sales_order_id");

-- CreateIndex
CREATE INDEX "sales_order_attachments_sales_order_id_idx" ON "sales_order_attachments"("sales_order_id");

-- CreateIndex
CREATE INDEX "sales_order_notes_sales_order_id_idx" ON "sales_order_notes"("sales_order_id");

-- CreateIndex
CREATE INDEX "shipments_store_order_id_idx" ON "shipments"("store_order_id");

-- CreateIndex
CREATE INDEX "shipments_sales_order_id_idx" ON "shipments"("sales_order_id");
