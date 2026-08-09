-- AlterEnum
BEGIN;
CREATE TYPE "ProductType_new" AS ENUM ('PURCHASE_ONLY', 'PURCHASE_AND_SALE', 'KIT', 'SERVICE', 'EXPENSE_ITEM');
-- Data-preserving remap (TASK-028): old STOCKABLE/DIGITAL/BUNDLE values no
-- longer exist as labels, so a bare cast would fail on any existing row.
-- Map old -> closest new equivalent instead of a naive text cast.
ALTER TABLE "products" ALTER COLUMN "type" TYPE "ProductType_new" USING (
  CASE "type"::text
    WHEN 'STOCKABLE' THEN 'PURCHASE_AND_SALE'
    WHEN 'CONSUMABLE' THEN 'PURCHASE_ONLY'
    WHEN 'SERVICE' THEN 'SERVICE'
    ELSE 'PURCHASE_AND_SALE'
  END
)::"ProductType_new";
ALTER TYPE "ProductType" RENAME TO "ProductType_old";
ALTER TYPE "ProductType_new" RENAME TO "ProductType";
DROP TYPE "public"."ProductType_old";
COMMIT;

-- CreateTable
CREATE TABLE "product_components" (
    "id" UUID NOT NULL,
    "kit_product_id" UUID NOT NULL,
    "component_product_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_components_kit_product_id_component_product_id_key" ON "product_components"("kit_product_id", "component_product_id");

-- AddForeignKey
ALTER TABLE "product_components" ADD CONSTRAINT "product_components_kit_product_id_fkey" FOREIGN KEY ("kit_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_components" ADD CONSTRAINT "product_components_component_product_id_fkey" FOREIGN KEY ("component_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

