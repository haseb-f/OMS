-- CreateEnum
CREATE TYPE "ProfitDistributionStatus" AS ENUM ('DRAFT', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvestorDistributionStatus" AS ENUM ('PENDING', 'PAYABLE', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DistributionPaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CapitalReturnStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvestorLedgerEntryType" AS ENUM ('CAPITAL_FUNDED', 'PROFIT_ENTITLEMENT', 'PROFIT_PAYMENT', 'CAPITAL_RETURN', 'ADJUSTMENT', 'REVERSAL');

-- AlterTable
ALTER TABLE "posting_settings" ADD COLUMN     "capital_return_account_id" UUID,
ADD COLUMN     "investor_funding_account_id" UUID,
ADD COLUMN     "investor_profit_distribution_account_id" UUID,
ADD COLUMN     "investor_profit_payable_account_id" UUID;

-- CreateTable
CREATE TABLE "profit_distributions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "profit_calculation_id" UUID NOT NULL,
    "total_investor_profit" DECIMAL(14,2) NOT NULL,
    "status" "ProfitDistributionStatus" NOT NULL DEFAULT 'DRAFT',
    "period_start" DATE,
    "period_end" DATE,
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profit_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investor_distributions" (
    "id" UUID NOT NULL,
    "profit_distribution_id" UUID NOT NULL,
    "investor_id" UUID NOT NULL,
    "source_share_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "entitled_amount" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "InvestorDistributionStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investor_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distribution_payments" (
    "id" UUID NOT NULL,
    "investor_distribution_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "payment_date" DATE NOT NULL,
    "financial_account_id" UUID NOT NULL,
    "payment_method_id" UUID,
    "reference_number" TEXT,
    "status" "DistributionPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_id" UUID,
    "confirmed_by_id" UUID,
    "confirmed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distribution_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distribution_payment_attachments" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "attachment_id" UUID,
    "uploaded_by_id" UUID NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "distribution_payment_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_returns" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "investor_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "financial_account_id" UUID,
    "reference_number" TEXT,
    "status" "CapitalReturnStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "paid_by_id" UUID,
    "paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capital_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investor_ledger_entries" (
    "id" UUID NOT NULL,
    "investor_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "entry_date" TIMESTAMP(3) NOT NULL,
    "type" "InvestorLedgerEntryType" NOT NULL,
    "description" TEXT NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" UUID NOT NULL,
    "debit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "investor_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profit_distributions_code_key" ON "profit_distributions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "profit_distributions_profit_calculation_id_key" ON "profit_distributions"("profit_calculation_id");

-- CreateIndex
CREATE INDEX "profit_distributions_opportunity_id_status_idx" ON "profit_distributions"("opportunity_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "investor_distributions_source_share_id_key" ON "investor_distributions"("source_share_id");

-- CreateIndex
CREATE INDEX "investor_distributions_investor_id_status_idx" ON "investor_distributions"("investor_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "investor_distributions_profit_distribution_id_investor_id_key" ON "investor_distributions"("profit_distribution_id", "investor_id");

-- CreateIndex
CREATE INDEX "distribution_payments_investor_distribution_id_status_idx" ON "distribution_payments"("investor_distribution_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "distribution_payment_attachments_attachment_id_key" ON "distribution_payment_attachments"("attachment_id");

-- CreateIndex
CREATE INDEX "distribution_payment_attachments_payment_id_deleted_at_idx" ON "distribution_payment_attachments"("payment_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "capital_returns_code_key" ON "capital_returns"("code");

-- CreateIndex
CREATE INDEX "capital_returns_investor_id_status_idx" ON "capital_returns"("investor_id", "status");

-- CreateIndex
CREATE INDEX "investor_ledger_entries_investor_id_entry_date_idx" ON "investor_ledger_entries"("investor_id", "entry_date");

-- CreateIndex
CREATE INDEX "investor_ledger_entries_opportunity_id_entry_date_idx" ON "investor_ledger_entries"("opportunity_id", "entry_date");

-- CreateIndex
CREATE UNIQUE INDEX "investor_ledger_entries_reference_type_reference_id_type_key" ON "investor_ledger_entries"("reference_type", "reference_id", "type");

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_investor_funding_account_id_fkey" FOREIGN KEY ("investor_funding_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_investor_profit_distribution_account_id_fkey" FOREIGN KEY ("investor_profit_distribution_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_investor_profit_payable_account_id_fkey" FOREIGN KEY ("investor_profit_payable_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_capital_return_account_id_fkey" FOREIGN KEY ("capital_return_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_distributions" ADD CONSTRAINT "profit_distributions_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "investment_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_distributions" ADD CONSTRAINT "profit_distributions_profit_calculation_id_fkey" FOREIGN KEY ("profit_calculation_id") REFERENCES "profit_calculations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_distributions" ADD CONSTRAINT "profit_distributions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profit_distributions" ADD CONSTRAINT "profit_distributions_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_distributions" ADD CONSTRAINT "investor_distributions_profit_distribution_id_fkey" FOREIGN KEY ("profit_distribution_id") REFERENCES "profit_distributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_distributions" ADD CONSTRAINT "investor_distributions_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_distributions" ADD CONSTRAINT "investor_distributions_source_share_id_fkey" FOREIGN KEY ("source_share_id") REFERENCES "profit_calculation_investor_shares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_distributions" ADD CONSTRAINT "investor_distributions_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "investor_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_payments" ADD CONSTRAINT "distribution_payments_investor_distribution_id_fkey" FOREIGN KEY ("investor_distribution_id") REFERENCES "investor_distributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_payments" ADD CONSTRAINT "distribution_payments_financial_account_id_fkey" FOREIGN KEY ("financial_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_payments" ADD CONSTRAINT "distribution_payments_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_payments" ADD CONSTRAINT "distribution_payments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_payments" ADD CONSTRAINT "distribution_payments_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_payment_attachments" ADD CONSTRAINT "distribution_payment_attachments_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "distribution_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_payment_attachments" ADD CONSTRAINT "distribution_payment_attachments_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_payment_attachments" ADD CONSTRAINT "distribution_payment_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_returns" ADD CONSTRAINT "capital_returns_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_returns" ADD CONSTRAINT "capital_returns_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "investor_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_returns" ADD CONSTRAINT "capital_returns_financial_account_id_fkey" FOREIGN KEY ("financial_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_returns" ADD CONSTRAINT "capital_returns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_returns" ADD CONSTRAINT "capital_returns_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_returns" ADD CONSTRAINT "capital_returns_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_ledger_entries" ADD CONSTRAINT "investor_ledger_entries_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_ledger_entries" ADD CONSTRAINT "investor_ledger_entries_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "investment_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_ledger_entries" ADD CONSTRAINT "investor_ledger_entries_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
