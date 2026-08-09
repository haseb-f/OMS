-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "line_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tax_id" UUID;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_tax_id_fkey" FOREIGN KEY ("tax_id") REFERENCES "taxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
