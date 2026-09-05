-- Canonical reusable Attachment objects + payment/order receipt links.
-- Legacy payment_attachments.file_url and store_order_receipts URL-only
-- rows remain readable (attachment_id null).

CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_provider" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "checksum" TEXT,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" UUID,
    "deletion_reason" TEXT,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attachments_storage_key_key" ON "attachments"("storage_key");
CREATE INDEX "attachments_uploaded_by_id_idx" ON "attachments"("uploaded_by_id");
CREATE INDEX "attachments_deleted_at_finalized_at_idx" ON "attachments"("deleted_at", "finalized_at");

ALTER TABLE "attachments"
    ADD CONSTRAINT "attachments_uploaded_by_id_fkey"
    FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attachments"
    ADD CONSTRAINT "attachments_deleted_by_id_fkey"
    FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_attachments"
    ADD COLUMN IF NOT EXISTS "attachment_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "payment_attachments_attachment_id_key"
    ON "payment_attachments"("attachment_id");

CREATE INDEX IF NOT EXISTS "payment_attachments_payment_id_deleted_at_idx"
    ON "payment_attachments"("payment_id", "deleted_at");

ALTER TABLE "payment_attachments"
    ADD CONSTRAINT "payment_attachments_attachment_id_fkey"
    FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "store_order_receipts"
    ADD COLUMN IF NOT EXISTS "attachment_id" UUID;

CREATE INDEX IF NOT EXISTS "store_order_receipts_payment_id_idx"
    ON "store_order_receipts"("payment_id");

CREATE INDEX IF NOT EXISTS "store_order_receipts_attachment_id_idx"
    ON "store_order_receipts"("attachment_id");

ALTER TABLE "store_order_receipts"
    ADD CONSTRAINT "store_order_receipts_attachment_id_fkey"
    FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
