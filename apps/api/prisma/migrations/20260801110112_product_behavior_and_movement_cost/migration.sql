-- AlterEnum
BEGIN;
CREATE TYPE "ProductType_new" AS ENUM ('PURCHASE_ONLY', 'SALES_ONLY', 'PURCHASE_AND_SALE', 'MANUFACTURED', 'SERVICE', 'EXPENSE_ITEM');
ALTER TABLE "products" ALTER COLUMN "type" TYPE "ProductType_new" USING ("type"::text::"ProductType_new");
ALTER TYPE "ProductType" RENAME TO "ProductType_old";
ALTER TYPE "ProductType_new" RENAME TO "ProductType";
DROP TYPE "public"."ProductType_old";
COMMIT;

-- AlterTable
ALTER TABLE "inventory_movements" ADD COLUMN     "unit_cost" DECIMAL(12,2);

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

