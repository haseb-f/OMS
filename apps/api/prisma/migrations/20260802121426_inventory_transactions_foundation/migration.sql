-- CreateEnum
CREATE TYPE "PhysicalCountStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "InventoryMovementType" ADD VALUE 'PHYSICAL_COUNT';

-- AlterTable
ALTER TABLE "inventory_movements" ADD COLUMN     "reason" TEXT;

-- CreateTable
CREATE TABLE "physical_counts" (
    "id" UUID NOT NULL,
    "count_number" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" "PhysicalCountStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "physical_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "physical_count_lines" (
    "id" UUID NOT NULL,
    "physical_count_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "system_quantity" INTEGER NOT NULL,
    "counted_quantity" INTEGER,
    "movement_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "physical_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "physical_counts_count_number_key" ON "physical_counts"("count_number");

-- CreateIndex
CREATE UNIQUE INDEX "physical_count_lines_physical_count_id_product_id_key" ON "physical_count_lines"("physical_count_id", "product_id");

-- AddForeignKey
ALTER TABLE "physical_counts" ADD CONSTRAINT "physical_counts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_count_lines" ADD CONSTRAINT "physical_count_lines_physical_count_id_fkey" FOREIGN KEY ("physical_count_id") REFERENCES "physical_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_count_lines" ADD CONSTRAINT "physical_count_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_count_lines" ADD CONSTRAINT "physical_count_lines_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "inventory_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
