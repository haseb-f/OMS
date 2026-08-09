-- AlterTable
ALTER TABLE "chart_of_accounts" ADD COLUMN     "allow_reconciliation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "currency_id" UUID;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
