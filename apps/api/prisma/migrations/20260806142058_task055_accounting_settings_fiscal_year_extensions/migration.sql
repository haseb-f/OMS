-- AlterTable
ALTER TABLE "fiscal_years" ADD COLUMN     "is_default" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "fiscal_year_id" UUID;

-- AlterTable
ALTER TABLE "posting_settings" ADD COLUMN     "exchange_difference_account_id" UUID,
ADD COLUMN     "purchase_discount_account_id" UUID,
ADD COLUMN     "retained_earnings_account_id" UUID,
ADD COLUMN     "suspense_account_id" UUID;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_purchase_discount_account_id_fkey" FOREIGN KEY ("purchase_discount_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_exchange_difference_account_id_fkey" FOREIGN KEY ("exchange_difference_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_suspense_account_id_fkey" FOREIGN KEY ("suspense_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_retained_earnings_account_id_fkey" FOREIGN KEY ("retained_earnings_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
