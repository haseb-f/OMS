-- CreateEnum
CREATE TYPE "CostAllocationMethod" AS ENUM ('BY_QUANTITY', 'BY_COST', 'EQUAL', 'MANUAL');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "current_cost" DECIMAL(12,2),
ADD COLUMN     "last_cost_update" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "cost_components" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "cost_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_component_activities" (
    "id" UUID NOT NULL,
    "cost_component_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "cost_component_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_allocation_rules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "method" "CostAllocationMethod" NOT NULL,
    "cost_component_id" UUID,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "cost_allocation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_cost_histories" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "previous_cost" DECIMAL(12,2),
    "new_cost" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "reference_type" TEXT,
    "reference_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "product_cost_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_cost_snapshots" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "product_cost_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cost_components_code_key" ON "cost_components"("code");

-- CreateIndex
CREATE UNIQUE INDEX "product_cost_snapshots_product_id_key" ON "product_cost_snapshots"("product_id");

-- AddForeignKey
ALTER TABLE "cost_component_activities" ADD CONSTRAINT "cost_component_activities_cost_component_id_fkey" FOREIGN KEY ("cost_component_id") REFERENCES "cost_components"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_allocation_rules" ADD CONSTRAINT "cost_allocation_rules_cost_component_id_fkey" FOREIGN KEY ("cost_component_id") REFERENCES "cost_components"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_cost_histories" ADD CONSTRAINT "product_cost_histories_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_cost_snapshots" ADD CONSTRAINT "product_cost_snapshots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
