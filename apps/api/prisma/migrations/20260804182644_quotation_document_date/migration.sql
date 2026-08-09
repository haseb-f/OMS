-- TASK-040: SalesQuotation gets an editable business date, independent of
-- the immutable createdAt system timestamp. Existing rows backfill to now().
ALTER TABLE "sales_quotations" ADD COLUMN "document_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
