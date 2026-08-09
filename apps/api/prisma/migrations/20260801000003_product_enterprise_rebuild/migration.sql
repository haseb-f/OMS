-- AlterEnum
BEGIN;
CREATE TYPE "ProductType_new" AS ENUM ('STOCKABLE', 'SERVICE', 'CONSUMABLE');
ALTER TABLE "products" ALTER COLUMN "type" TYPE "ProductType_new" USING ("type"::text::"ProductType_new");
ALTER TYPE "ProductType" RENAME TO "ProductType_old";
ALTER TYPE "ProductType_new" RENAME TO "ProductType";
DROP TYPE "public"."ProductType_old";
COMMIT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "allow_discount" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "analytic_account_id" UUID,
ADD COLUMN     "batch_tracking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "internal_notes" TEXT,
ADD COLUMN     "max_quantity" DECIMAL(12,3),
ADD COLUMN     "min_quantity" DECIMAL(12,3),
ADD COLUMN     "name_en" TEXT,
ADD COLUMN     "preferred_supplier_id" UUID,
ADD COLUMN     "purchase_description" TEXT,
ADD COLUMN     "purchase_price" DECIMAL(12,2),
ADD COLUMN     "qr_code_value" TEXT,
ADD COLUMN     "reorder_level" DECIMAL(12,3),
ADD COLUMN     "sales_description" TEXT,
ADD COLUMN     "sales_price" DECIMAL(12,2),
ADD COLUMN     "sales_tax_included" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serial_number_tracking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "storage_location" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "tax_id" UUID;

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "price_adjustment" DECIMAL(12,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attachments" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "product_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tax_id_fkey" FOREIGN KEY ("tax_id") REFERENCES "taxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_analytic_account_id_fkey" FOREIGN KEY ("analytic_account_id") REFERENCES "analytic_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_preferred_supplier_id_fkey" FOREIGN KEY ("preferred_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attachments" ADD CONSTRAINT "product_attachments_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attachments" ADD CONSTRAINT "product_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

