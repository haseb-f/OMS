-- CreateTable
CREATE TABLE "shipment_attachments" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "attachment_id" UUID,
    "uploaded_by_id" UUID NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT,
    "attachment_type" TEXT NOT NULL DEFAULT 'SHIPMENT_RECEIPT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" UUID,

    CONSTRAINT "shipment_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipment_attachments_attachment_id_key" ON "shipment_attachments"("attachment_id");

-- CreateIndex
CREATE INDEX "shipment_attachments_shipment_id_deleted_at_idx" ON "shipment_attachments"("shipment_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "shipment_attachments" ADD CONSTRAINT "shipment_attachments_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_attachments" ADD CONSTRAINT "shipment_attachments_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_attachments" ADD CONSTRAINT "shipment_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
