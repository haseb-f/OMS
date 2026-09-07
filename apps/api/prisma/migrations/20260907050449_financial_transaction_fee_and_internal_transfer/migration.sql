-- AlterEnum
ALTER TYPE "CashFlowOutgoingType" ADD VALUE 'INTERNAL_TRANSFER';

-- AlterTable
ALTER TABLE "bank_transactions" ADD COLUMN     "linked_transfer_transaction_id" UUID;

-- AlterTable
ALTER TABLE "financial_transactions" ADD COLUMN     "fee_account_id" UUID,
ADD COLUMN     "fee_amount" DECIMAL(12,2) DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_linked_transfer_transaction_id_key" ON "bank_transactions"("linked_transfer_transaction_id");

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_linked_transfer_transaction_id_fkey" FOREIGN KEY ("linked_transfer_transaction_id") REFERENCES "bank_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_fee_account_id_fkey" FOREIGN KEY ("fee_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

