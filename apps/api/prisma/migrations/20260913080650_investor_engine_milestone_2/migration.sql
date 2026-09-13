-- CreateEnum
CREATE TYPE "SaleAllocationType" AS ENUM ('AUTO', 'MANUAL', 'SETTLEMENT', 'REALLOCATION');

-- CreateEnum
CREATE TYPE "SaleAllocationStatus" AS ENUM ('ACTIVE', 'REVERSED');

-- CreateEnum
CREATE TYPE "OpportunityExpenseCategory" AS ENUM ('ADVERTISING', 'SHIPPING', 'STORAGE', 'PAYMENT_FEES', 'RETURNS', 'OTHER');

-- CreateEnum
CREATE TYPE "OpportunityExpenseStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ProfitCalculationStatus" AS ENUM ('ESTIMATED', 'APPROVED');

-- CreateEnum
CREATE TYPE "OpportunitySettlementStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReallocationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED');

-- CreateTable
CREATE TABLE "opportunity_sale_allocations" (
    "id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "opportunity_product_id" UUID NOT NULL,
    "store_order_id" UUID NOT NULL,
    "store_order_item_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "allocated_quantity" INTEGER NOT NULL,
    "allocated_revenue" DECIMAL(14,2) NOT NULL,
    "allocation_type" "SaleAllocationType" NOT NULL,
    "status" "SaleAllocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "allocated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allocated_by" UUID,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" UUID,
    "reversal_reason" TEXT,
    "source_allocation_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_sale_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_expenses" (
    "id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "expense_date" DATE NOT NULL,
    "category" "OpportunityExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "OpportunityExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "source_expense_id" UUID,
    "created_by" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_expense_attachments" (
    "id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "attachment_id" UUID,
    "uploaded_by_id" UUID NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT,
    "attachment_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" UUID,

    CONSTRAINT "opportunity_expense_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profit_calculations" (
    "id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "status" "ProfitCalculationStatus" NOT NULL DEFAULT 'ESTIMATED',
    "revenue" DECIMAL(14,2) NOT NULL,
    "cogs" DECIMAL(14,2) NOT NULL,
    "expenses" DECIMAL(14,2) NOT NULL,
    "returns_adjustment" DECIMAL(14,2) NOT NULL,
    "net_profit" DECIMAL(14,2) NOT NULL,
    "investor_share_percent" DECIMAL(5,2) NOT NULL,
    "investor_profit_pool" DECIMAL(14,2) NOT NULL,
    "company_profit_portion" DECIMAL(14,2) NOT NULL,
    "revenue_line_count" INTEGER NOT NULL,
    "net_units_count" INTEGER NOT NULL,
    "expense_line_count" INTEGER NOT NULL,
    "calculated_by_id" UUID,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profit_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profit_calculation_investor_shares" (
    "id" UUID NOT NULL,
    "profit_calculation_id" UUID NOT NULL,
    "investor_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "participation_percent" DECIMAL(7,4) NOT NULL,
    "profit_share_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profit_calculation_investor_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_settlements" (
    "id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "status" "OpportunitySettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "approved_by_id" UUID,
    "completed_at" TIMESTAMP(3),
    "unresolved_remaining_units" INTEGER,
    "unresolved_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_reallocations" (
    "id" UUID NOT NULL,
    "from_opportunity_id" UUID NOT NULL,
    "to_opportunity_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "store_order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReallocationStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "original_allocation_id" UUID,
    "new_allocation_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_reallocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opportunity_sale_allocations_store_order_item_id_status_idx" ON "opportunity_sale_allocations"("store_order_item_id", "status");

-- CreateIndex
CREATE INDEX "opportunity_sale_allocations_opportunity_id_status_idx" ON "opportunity_sale_allocations"("opportunity_id", "status");

-- CreateIndex
CREATE INDEX "opportunity_sale_allocations_opportunity_product_id_status_idx" ON "opportunity_sale_allocations"("opportunity_product_id", "status");

-- CreateIndex
CREATE INDEX "opportunity_sale_allocations_product_id_idx" ON "opportunity_sale_allocations"("product_id");

-- CreateIndex
CREATE INDEX "opportunity_sale_allocations_status_idx" ON "opportunity_sale_allocations"("status");

-- CreateIndex
CREATE INDEX "opportunity_expenses_opportunity_id_status_idx" ON "opportunity_expenses"("opportunity_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_expense_attachments_attachment_id_key" ON "opportunity_expense_attachments"("attachment_id");

-- CreateIndex
CREATE INDEX "opportunity_expense_attachments_expense_id_deleted_at_idx" ON "opportunity_expense_attachments"("expense_id", "deleted_at");

-- CreateIndex
CREATE INDEX "profit_calculations_opportunity_id_status_idx" ON "profit_calculations"("opportunity_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "profit_calculation_investor_shares_profit_calculation_id_in_key" ON "profit_calculation_investor_shares"("profit_calculation_id", "investor_id");

-- CreateIndex
CREATE INDEX "opportunity_settlements_opportunity_id_status_idx" ON "opportunity_settlements"("opportunity_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_reallocations_new_allocation_id_key" ON "opportunity_reallocations"("new_allocation_id");

-- CreateIndex
CREATE INDEX "opportunity_reallocations_from_opportunity_id_status_idx" ON "opportunity_reallocations"("from_opportunity_id", "status");

-- CreateIndex
CREATE INDEX "opportunity_reallocations_to_opportunity_id_status_idx" ON "opportunity_reallocations"("to_opportunity_id", "status");

-- AddForeignKey
ALTER TABLE "opportunity_sale_allocations" ADD CONSTRAINT "opportunity_sale_allocations_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "investment_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_sale_allocations" ADD CONSTRAINT "opportunity_sale_allocations_opportunity_product_id_fkey" FOREIGN KEY ("opportunity_product_id") REFERENCES "opportunity_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_sale_allocations" ADD CONSTRAINT "opportunity_sale_allocations_store_order_id_fkey" FOREIGN KEY ("store_order_id") REFERENCES "store_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_sale_allocations" ADD CONSTRAINT "opportunity_sale_allocations_store_order_item_id_fkey" FOREIGN KEY ("store_order_item_id") REFERENCES "store_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_sale_allocations" ADD CONSTRAINT "opportunity_sale_allocations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_sale_allocations" ADD CONSTRAINT "opportunity_sale_allocations_source_allocation_id_fkey" FOREIGN KEY ("source_allocation_id") REFERENCES "opportunity_sale_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_expenses" ADD CONSTRAINT "opportunity_expenses_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "investment_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_expenses" ADD CONSTRAINT "opportunity_expenses_source_expense_id_fkey" FOREIGN KEY ("source_expense_id") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_expenses" ADD CONSTRAINT "opportunity_expenses_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_expense_attachments" ADD CONSTRAINT "opportunity_expense_attachments_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "opportunity_expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_expense_attachments" ADD CONSTRAINT "opportunity_expense_attachments_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_expense_attachments" ADD CONSTRAINT "opportunity_expense_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_calculations" ADD CONSTRAINT "profit_calculations_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "investment_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_calculations" ADD CONSTRAINT "profit_calculations_calculated_by_id_fkey" FOREIGN KEY ("calculated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_calculations" ADD CONSTRAINT "profit_calculations_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_calculation_investor_shares" ADD CONSTRAINT "profit_calculation_investor_shares_profit_calculation_id_fkey" FOREIGN KEY ("profit_calculation_id") REFERENCES "profit_calculations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_calculation_investor_shares" ADD CONSTRAINT "profit_calculation_investor_shares_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_calculation_investor_shares" ADD CONSTRAINT "profit_calculation_investor_shares_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "investor_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_settlements" ADD CONSTRAINT "opportunity_settlements_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "investment_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_settlements" ADD CONSTRAINT "opportunity_settlements_started_by_id_fkey" FOREIGN KEY ("started_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_settlements" ADD CONSTRAINT "opportunity_settlements_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_reallocations" ADD CONSTRAINT "opportunity_reallocations_from_opportunity_id_fkey" FOREIGN KEY ("from_opportunity_id") REFERENCES "investment_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_reallocations" ADD CONSTRAINT "opportunity_reallocations_to_opportunity_id_fkey" FOREIGN KEY ("to_opportunity_id") REFERENCES "investment_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_reallocations" ADD CONSTRAINT "opportunity_reallocations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_reallocations" ADD CONSTRAINT "opportunity_reallocations_store_order_item_id_fkey" FOREIGN KEY ("store_order_item_id") REFERENCES "store_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_reallocations" ADD CONSTRAINT "opportunity_reallocations_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_reallocations" ADD CONSTRAINT "opportunity_reallocations_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_reallocations" ADD CONSTRAINT "opportunity_reallocations_original_allocation_id_fkey" FOREIGN KEY ("original_allocation_id") REFERENCES "opportunity_sale_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_reallocations" ADD CONSTRAINT "opportunity_reallocations_new_allocation_id_fkey" FOREIGN KEY ("new_allocation_id") REFERENCES "opportunity_sale_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
