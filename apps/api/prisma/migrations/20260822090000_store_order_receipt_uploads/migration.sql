-- Store Order receipts: binary upload metadata + soft delete.
-- URL-only rows remain valid (storage_key null). Do not apply to production
-- until the matching API/UI has been deployed.

ALTER TABLE "store_order_receipts"
  ADD COLUMN IF NOT EXISTS "file_size_bytes" INTEGER,
  ADD COLUMN IF NOT EXISTS "storage_key" TEXT,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
