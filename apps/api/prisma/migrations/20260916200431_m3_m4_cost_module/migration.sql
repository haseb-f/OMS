-- CreateEnum
CREATE TYPE "AllocationDimension" AS ENUM ('PRODUCT', 'CHANNEL', 'CUSTOMER', 'EMPLOYEE', 'COUNTRY');

-- CreateEnum
CREATE TYPE "CostAllocationRunStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "cost_allocation_rules" ADD COLUMN     "target_dimension" "AllocationDimension";

-- CreateTable
CREATE TABLE "cost_allocation_runs" (
    "id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "source_account_id" UUID,
    "manual_pool_amount" DECIMAL(14,2),
    "total_amount" DECIMAL(14,2) NOT NULL,
    "status" "CostAllocationRunStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "posted_at" TIMESTAMP(3),
    "posted_by" UUID,

    CONSTRAINT "cost_allocation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_allocation_results" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "dimension_value" TEXT NOT NULL,
    "dimension_label" TEXT,
    "basis_amount" DECIMAL(14,4) NOT NULL,
    "allocated_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_allocation_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cost_allocation_runs_rule_id_idx" ON "cost_allocation_runs"("rule_id");

-- CreateIndex
CREATE INDEX "cost_allocation_results_run_id_idx" ON "cost_allocation_results"("run_id");

-- AddForeignKey
ALTER TABLE "cost_allocation_runs" ADD CONSTRAINT "cost_allocation_runs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "cost_allocation_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_allocation_runs" ADD CONSTRAINT "cost_allocation_runs_source_account_id_fkey" FOREIGN KEY ("source_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_allocation_results" ADD CONSTRAINT "cost_allocation_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "cost_allocation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
