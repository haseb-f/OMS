/*
  Warnings:

  - Added the required column `display_name` to the `products` table without a default value. This is not possible if the table is not empty.
  - Added the required column `internal_name` to the `products` table without a default value. This is not possible if the table is not empty.
  - Added the required column `is_inventory_item` to the `products` table without a default value. This is not possible if the table is not empty.
  - Added the required column `is_purchasable` to the `products` table without a default value. This is not possible if the table is not empty.
  - Added the required column `is_sellable` to the `products` table without a default value. This is not possible if the table is not empty.
  - Made the column `category_id` on table `products` required. This step will fail if there are existing NULL values in that column.
  - Made the column `unit_id` on table `products` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_category_id_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_unit_id_fkey";

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "default_cost_method" TEXT,
ADD COLUMN     "default_tax_category" TEXT,
ADD COLUMN     "default_warehouse_id" UUID,
ADD COLUMN     "display_name" TEXT NOT NULL,
ADD COLUMN     "internal_name" TEXT NOT NULL,
ADD COLUMN     "is_inventory_item" BOOLEAN NOT NULL,
ADD COLUMN     "is_purchasable" BOOLEAN NOT NULL,
ADD COLUMN     "is_sellable" BOOLEAN NOT NULL,
ADD COLUMN     "long_description" TEXT,
ADD COLUMN     "search_keywords" TEXT,
ADD COLUMN     "short_description" TEXT,
ALTER COLUMN "category_id" SET NOT NULL,
ALTER COLUMN "unit_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
