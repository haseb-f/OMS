-- AlterTable
ALTER TABLE "customer_groups" ADD COLUMN     "default_receivable_account_id" UUID,
ADD COLUMN     "default_revenue_account_id" UUID;

-- AlterTable
ALTER TABLE "posting_settings" ADD COLUMN     "bank_account_id" UUID,
ADD COLUMN     "cash_account_id" UUID,
ADD COLUMN     "inventory_adjustment_account_id" UUID,
ADD COLUMN     "purchase_account_id" UUID,
ADD COLUMN     "purchase_return_account_id" UUID,
ADD COLUMN     "round_difference_account_id" UUID,
ADD COLUMN     "sales_discount_account_id" UUID,
ADD COLUMN     "sales_return_account_id" UUID,
ADD COLUMN     "vat_input_account_id" UUID,
ADD COLUMN     "vat_output_account_id" UUID;

-- AlterTable
ALTER TABLE "product_categories" ADD COLUMN     "cogs_account_id" UUID,
ADD COLUMN     "inventory_account_id" UUID,
ADD COLUMN     "purchase_account_id" UUID,
ADD COLUMN     "revenue_account_id" UUID;

-- AlterTable
ALTER TABLE "supplier_groups" ADD COLUMN     "default_payable_account_id" UUID,
ADD COLUMN     "default_purchase_account_id" UUID;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "supplier_group_id" UUID;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_revenue_account_id_fkey" FOREIGN KEY ("revenue_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_inventory_account_id_fkey" FOREIGN KEY ("inventory_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_cogs_account_id_fkey" FOREIGN KEY ("cogs_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_purchase_account_id_fkey" FOREIGN KEY ("purchase_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_supplier_group_id_fkey" FOREIGN KEY ("supplier_group_id") REFERENCES "supplier_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_groups" ADD CONSTRAINT "customer_groups_default_receivable_account_id_fkey" FOREIGN KEY ("default_receivable_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_groups" ADD CONSTRAINT "customer_groups_default_revenue_account_id_fkey" FOREIGN KEY ("default_revenue_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_groups" ADD CONSTRAINT "supplier_groups_default_payable_account_id_fkey" FOREIGN KEY ("default_payable_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_groups" ADD CONSTRAINT "supplier_groups_default_purchase_account_id_fkey" FOREIGN KEY ("default_purchase_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_sales_discount_account_id_fkey" FOREIGN KEY ("sales_discount_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_sales_return_account_id_fkey" FOREIGN KEY ("sales_return_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_inventory_adjustment_account_id_fkey" FOREIGN KEY ("inventory_adjustment_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_purchase_account_id_fkey" FOREIGN KEY ("purchase_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_purchase_return_account_id_fkey" FOREIGN KEY ("purchase_return_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_vat_output_account_id_fkey" FOREIGN KEY ("vat_output_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_vat_input_account_id_fkey" FOREIGN KEY ("vat_input_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_round_difference_account_id_fkey" FOREIGN KEY ("round_difference_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
