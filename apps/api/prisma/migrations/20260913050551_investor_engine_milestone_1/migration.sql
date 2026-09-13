-- CreateEnum
CREATE TYPE "InvestmentOpportunityStatus" AS ENUM ('DRAFT', 'OPEN', 'FUNDED', 'ACTIVE', 'ENDED', 'SETTLED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvestorSubscriptionStatus" AS ENUM ('PENDING', 'COMMITTED', 'PARTIALLY_FUNDED', 'FUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CapitalContributionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "PartnerRoleType" ADD VALUE 'INVESTOR';

-- CreateTable
CREATE TABLE "investor_profiles" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "user_id" UUID,
    "national_id" TEXT,
    "residency_id" TEXT,
    "iban" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "investor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_opportunities" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT,
    "description" TEXT,
    "currency_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "investor_net_profit_share_percent" DECIMAL(5,2) NOT NULL,
    "status" "InvestmentOpportunityStatus" NOT NULL DEFAULT 'DRAFT',
    "activated_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "investment_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_products" (
    "id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name_snapshot" TEXT NOT NULL,
    "funded_units" INTEGER NOT NULL,
    "funded_unit_cost" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "opportunity_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investor_subscriptions" (
    "id" UUID NOT NULL,
    "investor_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "committed_amount" DECIMAL(14,2) NOT NULL,
    "funded_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "participation_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "status" "InvestorSubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "investor_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_contributions" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "contribution_date" DATE NOT NULL,
    "payment_method_id" UUID,
    "financial_account_id" UUID,
    "reference_number" TEXT,
    "status" "CapitalContributionStatus" NOT NULL DEFAULT 'PENDING',
    "confirmed_by_id" UUID,
    "confirmed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "capital_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_contribution_attachments" (
    "id" UUID NOT NULL,
    "contribution_id" UUID NOT NULL,
    "attachment_id" UUID,
    "uploaded_by_id" UUID NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT,
    "attachment_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" UUID,

    CONSTRAINT "capital_contribution_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "investor_profiles_partner_id_key" ON "investor_profiles"("partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "investor_profiles_user_id_key" ON "investor_profiles"("user_id");

-- CreateIndex
CREATE INDEX "investor_profiles_deleted_at_idx" ON "investor_profiles"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "investment_opportunities_code_key" ON "investment_opportunities"("code");

-- CreateIndex
CREATE INDEX "investment_opportunities_deleted_at_status_idx" ON "investment_opportunities"("deleted_at", "status");

-- CreateIndex
CREATE INDEX "investment_opportunities_start_date_end_date_idx" ON "investment_opportunities"("start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_products_opportunity_id_product_id_key" ON "opportunity_products"("opportunity_id", "product_id");

-- CreateIndex
CREATE INDEX "investor_subscriptions_opportunity_id_status_idx" ON "investor_subscriptions"("opportunity_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "investor_subscriptions_investor_id_opportunity_id_key" ON "investor_subscriptions"("investor_id", "opportunity_id");

-- CreateIndex
CREATE INDEX "capital_contributions_subscription_id_status_idx" ON "capital_contributions"("subscription_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "capital_contribution_attachments_attachment_id_key" ON "capital_contribution_attachments"("attachment_id");

-- CreateIndex
CREATE INDEX "capital_contribution_attachments_contribution_id_deleted_at_idx" ON "capital_contribution_attachments"("contribution_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "investor_profiles" ADD CONSTRAINT "investor_profiles_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_profiles" ADD CONSTRAINT "investor_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_opportunities" ADD CONSTRAINT "investment_opportunities_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_products" ADD CONSTRAINT "opportunity_products_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "investment_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_products" ADD CONSTRAINT "opportunity_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_subscriptions" ADD CONSTRAINT "investor_subscriptions_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_subscriptions" ADD CONSTRAINT "investor_subscriptions_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "investment_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_contributions" ADD CONSTRAINT "capital_contributions_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "investor_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_contributions" ADD CONSTRAINT "capital_contributions_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_contributions" ADD CONSTRAINT "capital_contributions_financial_account_id_fkey" FOREIGN KEY ("financial_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_contributions" ADD CONSTRAINT "capital_contributions_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_contribution_attachments" ADD CONSTRAINT "capital_contribution_attachments_contribution_id_fkey" FOREIGN KEY ("contribution_id") REFERENCES "capital_contributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_contribution_attachments" ADD CONSTRAINT "capital_contribution_attachments_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_contribution_attachments" ADD CONSTRAINT "capital_contribution_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
