/*
  Warnings:

  - You are about to drop the column `default_cost_method` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `default_warehouse_id` on the `products` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ProductCostingMethod" AS ENUM ('AVERAGE', 'FIFO', 'STANDARD');

-- AlterTable
ALTER TABLE "products" DROP COLUMN "default_cost_method",
DROP COLUMN "default_warehouse_id",
ADD COLUMN     "costing_method" "ProductCostingMethod",
ADD COLUMN     "preferred_warehouse_id" UUID,
ADD COLUMN     "reorder_quantity" DECIMAL(12,3),
ADD COLUMN     "safety_stock" DECIMAL(12,3);

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "default_analytic_account_id" UUID,
ADD COLUMN     "manager_id" UUID;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_default_analytic_account_id_fkey" FOREIGN KEY ("default_analytic_account_id") REFERENCES "analytic_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_preferred_warehouse_id_fkey" FOREIGN KEY ("preferred_warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
