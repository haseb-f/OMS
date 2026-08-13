-- CreateEnum
CREATE TYPE "CashFlowDirection" AS ENUM ('INCOMING', 'OUTGOING');

-- CreateEnum
CREATE TYPE "CashFlowOutgoingType" AS ENUM ('SUPPLIER_PAYMENT', 'EXPENSE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BankTransactionMatchStatus" ADD VALUE 'PARTIALLY_MATCHED';
ALTER TYPE "BankTransactionMatchStatus" ADD VALUE 'CONFLICT';
ALTER TYPE "BankTransactionMatchStatus" ADD VALUE 'MANUAL_REVIEW';

-- AlterEnum
ALTER TYPE "FinancialTransactionType" ADD VALUE 'EXPENSE_PAYMENT';

-- AlterTable
ALTER TABLE "bank_transactions" ADD COLUMN     "cash_source_id" UUID,
ADD COLUMN     "conflict_reason" TEXT,
ADD COLUMN     "cost_center_id" UUID,
ADD COLUMN     "direction" "CashFlowDirection",
ADD COLUMN     "expense_account_id" UUID,
ADD COLUMN     "matched_financial_transaction_id" UUID,
ADD COLUMN     "outgoing_type" "CashFlowOutgoingType",
ADD COLUMN     "partner_supplier_id" UUID,
ADD COLUMN     "project_id" UUID;

-- AlterTable
ALTER TABLE "financial_transactions" ADD COLUMN     "expense_account_id" UUID;

-- CreateIndex
CREATE INDEX "bank_transactions_direction_match_status_idx" ON "bank_transactions"("direction", "match_status");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_cash_source_id_transaction_id_key" ON "bank_transactions"("cash_source_id", "transaction_id");

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_cash_source_id_fkey" FOREIGN KEY ("cash_source_id") REFERENCES "receiving_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_partner_supplier_id_fkey" FOREIGN KEY ("partner_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matched_financial_transaction_id_fkey" FOREIGN KEY ("matched_financial_transaction_id") REFERENCES "financial_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

