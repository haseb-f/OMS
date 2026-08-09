-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "external_order_id" TEXT;

-- CreateIndex
CREATE INDEX "leads_external_order_id_idx" ON "leads"("external_order_id");
