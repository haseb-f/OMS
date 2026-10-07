-- R14 W5 — Company partners and profit sharing ("الشركاء", spec-5).
--
-- Additive only: new tables / enums, two nullable PostingSettings account
-- columns (chosen in Settings → Accounting, decision D5-3 — nothing is
-- created automatically), the four company-partners.* permissions (granted
-- to nobody; super admin bypasses) and the partner-payment number series.
--
-- Reverse with: DROP TABLE partner_payments, partner_entitlements,
-- partner_profit_adjustments, partner_profit_periods, partner_agreements,
-- company_partner_profiles; DROP the 7 enums; ALTER TABLE posting_settings
-- DROP COLUMN partner_profit_distribution_account_id, DROP COLUMN
-- partner_profit_payable_account_id; DELETE the permissions and number series below.

-- CreateEnum
CREATE TYPE "CompanyPartnerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PartnerProfitBasis" AS ENUM ('GROSS_PROFIT', 'NET_PROFIT');

-- CreateEnum
CREATE TYPE "PartnerAgreementFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "PartnerAgreementScope" AS ENUM ('ALL');

-- CreateEnum
CREATE TYPE "PartnerAgreementStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "PartnerProfitPeriodStatus" AS ENUM ('PREVIEW', 'CLOSED');

-- CreateEnum
CREATE TYPE "PartnerEntitlementKind" AS ENUM ('ORIGINAL', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "posting_settings" ADD COLUMN     "partner_profit_distribution_account_id" UUID,
ADD COLUMN     "partner_profit_payable_account_id" UUID;

-- CreateTable
CREATE TABLE "company_partner_profiles" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "ownership_percent" DECIMAL(7,4),
    "notes" TEXT,
    "status" "CompanyPartnerStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "company_partner_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_agreements" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "profit_share_percent" DECIMAL(7,4) NOT NULL,
    "basis" "PartnerProfitBasis" NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "frequency" "PartnerAgreementFrequency" NOT NULL,
    "scope" "PartnerAgreementScope" NOT NULL DEFAULT 'ALL',
    "status" "PartnerAgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "supersedes_id" UUID,
    "notes" TEXT,
    "activated_at" TIMESTAMP(3),
    "activated_by" UUID,
    "ended_at" TIMESTAMP(3),
    "ended_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "partner_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_profit_periods" (
    "id" UUID NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "frequency" "PartnerAgreementFrequency" NOT NULL,
    "status" "PartnerProfitPeriodStatus" NOT NULL DEFAULT 'PREVIEW',
    "snapshot" JSONB NOT NULL,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" UUID,
    "closed_at" TIMESTAMP(3),
    "closed_by" UUID,
    "journal_entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "partner_profit_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_profit_adjustments" (
    "id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "entry_date" DATE NOT NULL,
    "journal_entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "partner_profit_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_entitlements" (
    "id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "adjustment_id" UUID,
    "partner_id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "basis" "PartnerProfitBasis" NOT NULL,
    "segment_from" DATE NOT NULL,
    "segment_to" DATE NOT NULL,
    "base_amount" DECIMAL(16,2) NOT NULL,
    "percent" DECIMAL(7,4) NOT NULL,
    "days" INTEGER NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "kind" "PartnerEntitlementKind" NOT NULL DEFAULT 'ORIGINAL',
    "journal_entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "partner_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_payments" (
    "id" UUID NOT NULL,
    "payment_number" TEXT NOT NULL,
    "partner_id" UUID NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "date" DATE NOT NULL,
    "financial_account_id" UUID NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "journal_entry_id" UUID,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" UUID,
    "reversal_reason" TEXT,
    "reversal_journal_entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "partner_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_partner_profiles_partner_id_key" ON "company_partner_profiles"("partner_id");

-- CreateIndex
CREATE INDEX "company_partner_profiles_status_idx" ON "company_partner_profiles"("status");

-- CreateIndex
CREATE UNIQUE INDEX "partner_agreements_supersedes_id_key" ON "partner_agreements"("supersedes_id");

-- CreateIndex
CREATE INDEX "partner_agreements_partner_id_status_idx" ON "partner_agreements"("partner_id", "status");

-- CreateIndex
CREATE INDEX "partner_agreements_status_effective_from_idx" ON "partner_agreements"("status", "effective_from");

-- CreateIndex
CREATE INDEX "partner_profit_periods_status_idx" ON "partner_profit_periods"("status");

-- CreateIndex
CREATE UNIQUE INDEX "partner_profit_periods_period_from_period_to_key" ON "partner_profit_periods"("period_from", "period_to");

-- CreateIndex
CREATE INDEX "partner_profit_adjustments_period_id_idx" ON "partner_profit_adjustments"("period_id");

-- CreateIndex
CREATE INDEX "partner_entitlements_period_id_partner_id_idx" ON "partner_entitlements"("period_id", "partner_id");

-- CreateIndex
CREATE INDEX "partner_entitlements_partner_id_kind_idx" ON "partner_entitlements"("partner_id", "kind");

-- CreateIndex
CREATE INDEX "partner_entitlements_adjustment_id_idx" ON "partner_entitlements"("adjustment_id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_payments_payment_number_key" ON "partner_payments"("payment_number");

-- CreateIndex
CREATE INDEX "partner_payments_partner_id_date_idx" ON "partner_payments"("partner_id", "date");

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_partner_profit_distribution_account_id_fkey" FOREIGN KEY ("partner_profit_distribution_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_partner_profit_payable_account_id_fkey" FOREIGN KEY ("partner_profit_payable_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_partner_profiles" ADD CONSTRAINT "company_partner_profiles_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_agreements" ADD CONSTRAINT "partner_agreements_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_agreements" ADD CONSTRAINT "partner_agreements_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "partner_agreements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_profit_adjustments" ADD CONSTRAINT "partner_profit_adjustments_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "partner_profit_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_entitlements" ADD CONSTRAINT "partner_entitlements_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "partner_profit_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_entitlements" ADD CONSTRAINT "partner_entitlements_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "partner_profit_adjustments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_entitlements" ADD CONSTRAINT "partner_entitlements_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_entitlements" ADD CONSTRAINT "partner_entitlements_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "partner_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payments" ADD CONSTRAINT "partner_payments_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payments" ADD CONSTRAINT "partner_payments_financial_account_id_fkey" FOREIGN KEY ("financial_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Permissions (catalog module `company-partners`). Granted to nobody.
INSERT INTO "permissions" ("id", "name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), p.name, 'Permission Matrix: ' || p.name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('company-partners.view'),
  ('company-partners.manage'),
  ('company-partners.close'),
  ('company-partners.pay')
) AS p(name)
WHERE NOT EXISTS (SELECT 1 FROM "permissions" existing WHERE existing."name" = p.name);

-- Partner payment numbers ("PPY-2026-000001") — never typed by hand.
INSERT INTO "number_series" (
  "id", "document_type", "label", "doc_code", "template",
  "next_number", "padding", "separator",
  "year_reset", "month_reset", "day_reset", "active",
  "created_at", "updated_at"
)
VALUES
  (gen_random_uuid(), 'COMPANY_PARTNER_PAYMENT', 'Partner Profit Payment', 'PPY', '{DOC}-{YEAR}-{SEQ}', 1, 6, '-', true, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("document_type") DO NOTHING;
