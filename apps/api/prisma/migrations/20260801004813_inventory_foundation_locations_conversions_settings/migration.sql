-- CreateEnum
CREATE TYPE "InventoryValuationMethod" AS ENUM ('AVERAGE_COST', 'FIFO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InventoryMovementType" ADD VALUE 'PURCHASE_RECEIPT';
ALTER TYPE "InventoryMovementType" ADD VALUE 'PURCHASE_RETURN';
ALTER TYPE "InventoryMovementType" ADD VALUE 'SALES_DELIVERY';
ALTER TYPE "InventoryMovementType" ADD VALUE 'SALES_RETURN';
ALTER TYPE "InventoryMovementType" ADD VALUE 'PRODUCTION_CONSUMPTION';
ALTER TYPE "InventoryMovementType" ADD VALUE 'PRODUCTION_OUTPUT';

-- CreateTable
CREATE TABLE "unit_conversions" (
    "id" UUID NOT NULL,
    "from_unit_id" UUID NOT NULL,
    "to_unit_id" UUID NOT NULL,
    "conversion_ratio" DECIMAL(18,6) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "unit_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_locations" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "warehouse_id" UUID NOT NULL,
    "parent_location_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "warehouse_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "valuation_method" "InventoryValuationMethod" NOT NULL DEFAULT 'AVERAGE_COST',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "inventory_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unit_conversions_from_unit_id_to_unit_id_key" ON "unit_conversions"("from_unit_id", "to_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_locations_code_key" ON "warehouse_locations"("code");

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_from_unit_id_fkey" FOREIGN KEY ("from_unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_to_unit_id_fkey" FOREIGN KEY ("to_unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_parent_location_id_fkey" FOREIGN KEY ("parent_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
