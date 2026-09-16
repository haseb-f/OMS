-- CreateEnum
CREATE TYPE "CostAccountingClass" AS ENUM ('INVENTORY_ACQUISITION', 'COGS', 'FULFILLMENT', 'TRANSACTION', 'OPERATING_EXPENSE', 'OTHER');

-- CreateEnum
CREATE TYPE "LandedCostStatus" AS ENUM ('DRAFT', 'APPROVED', 'POSTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "cost_components" ADD COLUMN     "accounting_class" "CostAccountingClass" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "capitalizable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "default_account_id" UUID,
ADD COLUMN     "name_en" TEXT,
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "posting_settings" ADD COLUMN     "landed_cost_clearing_account_id" UUID;

-- CreateTable
CREATE TABLE "landed_cost_documents" (
    "id" UUID NOT NULL,
    "document_number" TEXT NOT NULL,
    "purchase_invoice_id" UUID NOT NULL,
    "provider_id" UUID,
    "currency_id" UUID NOT NULL,
    "reference_number" TEXT,
    "document_date" DATE NOT NULL,
    "allocation_method" "CostAllocationMethod" NOT NULL,
    "status" "LandedCostStatus" NOT NULL DEFAULT 'DRAFT',
    "net_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "approved_at" TIMESTAMP(3),
    "approved_by" UUID,
    "posted_at" TIMESTAMP(3),
    "posted_by" UUID,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "landed_cost_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landed_cost_lines" (
    "id" UUID NOT NULL,
    "landed_cost_document_id" UUID NOT NULL,
    "cost_component_id" UUID NOT NULL,
    "description" TEXT,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "tax_id" UUID,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landed_cost_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landed_cost_allocations" (
    "id" UUID NOT NULL,
    "landed_cost_document_id" UUID NOT NULL,
    "purchase_invoice_item_id" UUID NOT NULL,
    "allocated_quantity" INTEGER NOT NULL,
    "allocated_amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "landed_cost_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landed_cost_activities" (
    "id" UUID NOT NULL,
    "landed_cost_document_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "landed_cost_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "landed_cost_documents_document_number_key" ON "landed_cost_documents"("document_number");

-- CreateIndex
CREATE INDEX "landed_cost_documents_purchase_invoice_id_idx" ON "landed_cost_documents"("purchase_invoice_id");

-- CreateIndex
CREATE INDEX "landed_cost_documents_deleted_at_status_idx" ON "landed_cost_documents"("deleted_at", "status");

-- CreateIndex
CREATE UNIQUE INDEX "landed_cost_allocations_landed_cost_document_id_purchase_in_key" ON "landed_cost_allocations"("landed_cost_document_id", "purchase_invoice_item_id");

-- CreateIndex
CREATE INDEX "cost_components_deleted_at_is_active_sort_order_idx" ON "cost_components"("deleted_at", "is_active", "sort_order");

-- AddForeignKey
ALTER TABLE "cost_components" ADD CONSTRAINT "cost_components_default_account_id_fkey" FOREIGN KEY ("default_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_documents" ADD CONSTRAINT "landed_cost_documents_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_documents" ADD CONSTRAINT "landed_cost_documents_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_documents" ADD CONSTRAINT "landed_cost_documents_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_lines" ADD CONSTRAINT "landed_cost_lines_landed_cost_document_id_fkey" FOREIGN KEY ("landed_cost_document_id") REFERENCES "landed_cost_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_lines" ADD CONSTRAINT "landed_cost_lines_cost_component_id_fkey" FOREIGN KEY ("cost_component_id") REFERENCES "cost_components"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_lines" ADD CONSTRAINT "landed_cost_lines_tax_id_fkey" FOREIGN KEY ("tax_id") REFERENCES "taxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_allocations" ADD CONSTRAINT "landed_cost_allocations_landed_cost_document_id_fkey" FOREIGN KEY ("landed_cost_document_id") REFERENCES "landed_cost_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_allocations" ADD CONSTRAINT "landed_cost_allocations_purchase_invoice_item_id_fkey" FOREIGN KEY ("purchase_invoice_item_id") REFERENCES "purchase_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_cost_activities" ADD CONSTRAINT "landed_cost_activities_landed_cost_document_id_fkey" FOREIGN KEY ("landed_cost_document_id") REFERENCES "landed_cost_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_landed_cost_clearing_account_id_fkey" FOREIGN KEY ("landed_cost_clearing_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
