-- Agents / Fulfillment Partners (specs/agents-fulfillment-partners). Additive only:
-- every existing user is INTERNAL, every existing product/order/lead/payment/movement
-- keeps a NULL agent and unchanged behavior.

-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('INTERNAL', 'AGENT');

-- CreateEnum
CREATE TYPE "AgentRole" AS ENUM ('ADMIN', 'SALES');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AgentAgreementStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "AgentCommissionEarningEvent" AS ENUM ('DELIVERED', 'PAYMENT_VERIFIED');

-- CreateEnum
CREATE TYPE "AgentReturnCommissionTreatment" AS ENUM ('REVERSE', 'RETAIN');

-- CreateEnum
CREATE TYPE "AgentChargeOwner" AS ENUM ('COMPANY', 'AGENT');

-- CreateEnum
CREATE TYPE "AgentDestinationOwnership" AS ENUM ('COMPANY', 'AGENT');

-- CreateEnum
CREATE TYPE "StoreOrderPricingMode" AS ENUM ('SHIPPING_ADDED', 'SHIPPING_INCLUDED');

-- CreateEnum
CREATE TYPE "ShippingChargeSource" AS ENUM ('NONE', 'RATE', 'MANUAL');

-- CreateEnum
CREATE TYPE "AgentLedgerEntryType" AS ENUM ('COLLECTION_RECEIVED', 'COLLECTION_BY_AGENT', 'COLLECTION_REVERSAL', 'COMMISSION', 'COMMISSION_REVERSAL', 'CUSTOMER_SHIPPING_RETAINED', 'CUSTOMER_SHIPPING_RETAINED_REVERSAL', 'SHIPPING_FEE', 'RETURN_FEE', 'SERVICE_FEE', 'PROVIDER_FEE', 'CUSTOMER_REFUND', 'PAYOUT', 'PAYOUT_REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "AgentLedgerPostingStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING_CONFIGURATION', 'POSTED');

-- CreateEnum
CREATE TYPE "AgentPayoutStatus" AS ENUM ('CONFIRMED', 'REVERSED');

-- AlterEnum
ALTER TYPE "PartnerRoleType" ADD VALUE 'AGENT';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "agent_id" UUID,
ADD COLUMN     "agent_role" "AgentRole",
ADD COLUMN     "user_type" "UserType" NOT NULL DEFAULT 'INTERNAL';

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "agent_id" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "agent_id" UUID,
ADD COLUMN     "agent_payment_destination_id" UUID,
ADD COLUMN     "destination_ownership" "AgentDestinationOwnership";

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "owner_agent_id" UUID;

-- AlterTable
ALTER TABLE "inventory_movements" ADD COLUMN     "owner_agent_id" UUID;

-- AlterTable
ALTER TABLE "store_orders" ADD COLUMN     "agent_agreement_id" UUID,
ADD COLUMN     "agent_dispatched_at" TIMESTAMP(3),
ADD COLUMN     "agent_earned_at" TIMESTAMP(3),
ADD COLUMN     "agent_id" UUID,
ADD COLUMN     "agent_terms_snapshot" JSONB,
ADD COLUMN     "discount_amount" DECIMAL(12,2),
ADD COLUMN     "merchandise_amount" DECIMAL(12,2),
ADD COLUMN     "payable_total" DECIMAL(12,2),
ADD COLUMN     "pricing_mode" "StoreOrderPricingMode",
ADD COLUMN     "service_charge" DECIMAL(12,2),
ADD COLUMN     "shipping_charge" DECIMAL(12,2),
ADD COLUMN     "shipping_charge_source" "ShippingChargeSource",
ADD COLUMN     "shipping_override_reason" TEXT,
ADD COLUMN     "shipping_rate_amount" DECIMAL(12,2),
ADD COLUMN     "tax_amount" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "posting_settings" ADD COLUMN     "agent_commission_revenue_account_id" UUID,
ADD COLUMN     "agent_funds_payable_account_id" UUID,
ADD COLUMN     "agent_service_revenue_account_id" UUID;

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL,
    "agent_number" TEXT NOT NULL,
    "partner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "status" "AgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "currency_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_agreements" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "agreement_number" TEXT NOT NULL,
    "status" "AgentAgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "currency_id" UUID NOT NULL,
    "commission_rate_percent" DECIMAL(7,4) NOT NULL,
    "commission_earning_event" "AgentCommissionEarningEvent" NOT NULL,
    "return_commission_treatment" "AgentReturnCommissionTreatment" NOT NULL,
    "customer_shipping_charge_owner" "AgentChargeOwner" NOT NULL,
    "provider_fees_borne_by" "AgentChargeOwner" NOT NULL,
    "shipping_fee_per_shipment" DECIMAL(12,2) NOT NULL,
    "return_fee_per_shipment" DECIMAL(12,2) NOT NULL,
    "service_fee_per_order" DECIMAL(12,2) NOT NULL,
    "allow_agent_destinations" BOOLEAN NOT NULL DEFAULT false,
    "payout_hold_days" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "activated_at" TIMESTAMP(3),
    "activated_by" UUID,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "agent_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_shipping_rates" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "country_id" UUID NOT NULL,
    "city" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "agent_shipping_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_payment_destinations" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "payment_method_id" UUID NOT NULL,
    "ownership" "AgentDestinationOwnership" NOT NULL,
    "label" TEXT NOT NULL,
    "details" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "agent_payment_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_ledger_entries" (
    "id" UUID NOT NULL,
    "entry_number" TEXT NOT NULL,
    "agent_id" UUID NOT NULL,
    "entry_type" "AgentLedgerEntryType" NOT NULL,
    "entry_date" TIMESTAMP(3) NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "store_order_id" UUID,
    "payment_id" UUID,
    "payout_id" UUID,
    "currency_id" UUID NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "memo_amount" DECIMAL(14,2),
    "basis" JSONB,
    "description" TEXT NOT NULL,
    "available_at" TIMESTAMP(3),
    "posting_status" "AgentLedgerPostingStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "journal_entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "agent_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_payouts" (
    "id" UUID NOT NULL,
    "payout_number" TEXT NOT NULL,
    "agent_id" UUID NOT NULL,
    "status" "AgentPayoutStatus" NOT NULL DEFAULT 'CONFIRMED',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency_id" UUID NOT NULL,
    "paying_account_id" UUID NOT NULL,
    "payout_date" TIMESTAMP(3) NOT NULL,
    "reference" TEXT NOT NULL,
    "notes" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" UUID,
    "reversal_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "agent_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_payout_allocations" (
    "id" UUID NOT NULL,
    "payout_id" UUID NOT NULL,
    "ledger_entry_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "agent_payout_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_payout_attachments" (
    "id" UUID NOT NULL,
    "payout_id" UUID NOT NULL,
    "attachment_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_payout_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_order_returns" (
    "id" UUID NOT NULL,
    "return_number" TEXT NOT NULL,
    "agent_id" UUID NOT NULL,
    "store_order_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "lines" JSONB NOT NULL,
    "merchandise_amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "agent_order_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_agent_number_key" ON "agents"("agent_number");

-- CreateIndex
CREATE UNIQUE INDEX "agents_partner_id_key" ON "agents"("partner_id");

-- CreateIndex
CREATE INDEX "agents_status_idx" ON "agents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_agreements_agreement_number_key" ON "agent_agreements"("agreement_number");

-- CreateIndex
CREATE INDEX "agent_agreements_agent_id_status_effective_from_idx" ON "agent_agreements"("agent_id", "status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "agent_shipping_rates_agreement_id_country_id_city_key" ON "agent_shipping_rates"("agreement_id", "country_id", "city");

-- CreateIndex
CREATE UNIQUE INDEX "agent_payment_destinations_agent_id_payment_method_id_owner_key" ON "agent_payment_destinations"("agent_id", "payment_method_id", "ownership");

-- CreateIndex
CREATE UNIQUE INDEX "agent_ledger_entries_entry_number_key" ON "agent_ledger_entries"("entry_number");

-- CreateIndex
CREATE INDEX "agent_ledger_entries_agent_id_entry_date_idx" ON "agent_ledger_entries"("agent_id", "entry_date");

-- CreateIndex
CREATE INDEX "agent_ledger_entries_store_order_id_idx" ON "agent_ledger_entries"("store_order_id");

-- CreateIndex
CREATE INDEX "agent_ledger_entries_posting_status_idx" ON "agent_ledger_entries"("posting_status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_ledger_entries_source_type_source_id_entry_type_key" ON "agent_ledger_entries"("source_type", "source_id", "entry_type");

-- CreateIndex
CREATE UNIQUE INDEX "agent_payouts_payout_number_key" ON "agent_payouts"("payout_number");

-- CreateIndex
CREATE UNIQUE INDEX "agent_payouts_idempotency_key_key" ON "agent_payouts"("idempotency_key");

-- CreateIndex
CREATE INDEX "agent_payouts_agent_id_payout_date_idx" ON "agent_payouts"("agent_id", "payout_date");

-- CreateIndex
CREATE INDEX "agent_payout_allocations_ledger_entry_id_idx" ON "agent_payout_allocations"("ledger_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_payout_attachments_payout_id_attachment_id_key" ON "agent_payout_attachments"("payout_id", "attachment_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_order_returns_return_number_key" ON "agent_order_returns"("return_number");

-- CreateIndex
CREATE UNIQUE INDEX "agent_order_returns_idempotency_key_key" ON "agent_order_returns"("idempotency_key");

-- CreateIndex
CREATE INDEX "agent_order_returns_store_order_id_idx" ON "agent_order_returns"("store_order_id");

-- CreateIndex
CREATE INDEX "store_orders_agent_id_created_at_idx" ON "store_orders"("agent_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_agent_payment_destination_id_fkey" FOREIGN KEY ("agent_payment_destination_id") REFERENCES "agent_payment_destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_owner_agent_id_fkey" FOREIGN KEY ("owner_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_agent_agreement_id_fkey" FOREIGN KEY ("agent_agreement_id") REFERENCES "agent_agreements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_agent_funds_payable_account_id_fkey" FOREIGN KEY ("agent_funds_payable_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_agent_commission_revenue_account_id_fkey" FOREIGN KEY ("agent_commission_revenue_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_agent_service_revenue_account_id_fkey" FOREIGN KEY ("agent_service_revenue_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_agreements" ADD CONSTRAINT "agent_agreements_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_agreements" ADD CONSTRAINT "agent_agreements_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_shipping_rates" ADD CONSTRAINT "agent_shipping_rates_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agent_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_shipping_rates" ADD CONSTRAINT "agent_shipping_rates_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_payment_destinations" ADD CONSTRAINT "agent_payment_destinations_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_payment_destinations" ADD CONSTRAINT "agent_payment_destinations_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_ledger_entries" ADD CONSTRAINT "agent_ledger_entries_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_ledger_entries" ADD CONSTRAINT "agent_ledger_entries_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_payouts" ADD CONSTRAINT "agent_payouts_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_payouts" ADD CONSTRAINT "agent_payouts_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_payouts" ADD CONSTRAINT "agent_payouts_paying_account_id_fkey" FOREIGN KEY ("paying_account_id") REFERENCES "receiving_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_payout_allocations" ADD CONSTRAINT "agent_payout_allocations_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "agent_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_payout_allocations" ADD CONSTRAINT "agent_payout_allocations_ledger_entry_id_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "agent_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_payout_attachments" ADD CONSTRAINT "agent_payout_attachments_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "agent_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_payout_attachments" ADD CONSTRAINT "agent_payout_attachments_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_order_returns" ADD CONSTRAINT "agent_order_returns_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_order_returns" ADD CONSTRAINT "agent_order_returns_store_order_id_fkey" FOREIGN KEY ("store_order_id") REFERENCES "store_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Integrity guards (spec §3, §8, §9)
ALTER TABLE "users" ADD CONSTRAINT "users_agent_affiliation_chk" CHECK (
  ("user_type" = 'INTERNAL' AND "agent_id" IS NULL AND "agent_role" IS NULL)
  OR ("user_type" = 'AGENT' AND "agent_id" IS NOT NULL AND "agent_role" IS NOT NULL AND "is_super_admin" = false)
);
ALTER TABLE "agent_ledger_entries" ADD CONSTRAINT "agent_ledger_amounts_chk" CHECK (
  "debit" >= 0 AND "credit" >= 0 AND NOT ("debit" > 0 AND "credit" > 0)
);
ALTER TABLE "agent_payouts" ADD CONSTRAINT "agent_payouts_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "agent_payout_allocations" ADD CONSTRAINT "agent_payout_allocations_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "agent_agreements" ADD CONSTRAINT "agent_agreements_terms_chk" CHECK (
  "commission_rate_percent" >= 0 AND "commission_rate_percent" <= 100
  AND "shipping_fee_per_shipment" >= 0 AND "return_fee_per_shipment" >= 0
  AND "service_fee_per_order" >= 0 AND "payout_hold_days" >= 0
  AND ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);
ALTER TABLE "agent_shipping_rates" ADD CONSTRAINT "agent_shipping_rates_amount_chk" CHECK ("amount" >= 0);

-- The agent ledger is append-only: no deletes, no truncate; amounts, type,
-- source, links and basis never change. Only the posting lifecycle moves
-- forward (PENDING_CONFIGURATION -> POSTED / NOT_APPLICABLE, journal link
-- null -> value once) and the computed availability may be refreshed.
CREATE OR REPLACE FUNCTION agent_ledger_entries_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'agent_ledger_entries is append-only';
  END IF;
  IF NEW."debit" <> OLD."debit" OR NEW."credit" <> OLD."credit"
     OR NEW."agent_id" <> OLD."agent_id" OR NEW."entry_type" <> OLD."entry_type"
     OR NEW."source_type" <> OLD."source_type" OR NEW."source_id" <> OLD."source_id"
     OR NEW."currency_id" <> OLD."currency_id" OR NEW."entry_date" <> OLD."entry_date"
     OR NEW."entry_number" <> OLD."entry_number"
     OR NEW."memo_amount" IS DISTINCT FROM OLD."memo_amount"
     OR NEW."basis"::text IS DISTINCT FROM OLD."basis"::text
     OR NEW."description" <> OLD."description"
     OR NEW."store_order_id" IS DISTINCT FROM OLD."store_order_id"
     OR NEW."payment_id" IS DISTINCT FROM OLD."payment_id"
     OR NEW."payout_id" IS DISTINCT FROM OLD."payout_id"
     OR NEW."created_at" <> OLD."created_at"
     OR NEW."created_by" IS DISTINCT FROM OLD."created_by" THEN
    RAISE EXCEPTION 'agent_ledger_entries amounts, links and identity are immutable';
  END IF;
  IF NEW."posting_status" <> OLD."posting_status"
     AND NOT (OLD."posting_status" = 'PENDING_CONFIGURATION'
              AND NEW."posting_status" IN ('POSTED', 'NOT_APPLICABLE')) THEN
    RAISE EXCEPTION 'agent_ledger_entries posting status can only move from PENDING_CONFIGURATION';
  END IF;
  IF NEW."journal_entry_id" IS DISTINCT FROM OLD."journal_entry_id"
     AND OLD."journal_entry_id" IS NOT NULL THEN
    RAISE EXCEPTION 'agent_ledger_entries journal link is set once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_ledger_entries_guard_trg
  BEFORE UPDATE OR DELETE ON "agent_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION agent_ledger_entries_guard();

CREATE OR REPLACE FUNCTION agent_ledger_entries_no_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'agent_ledger_entries is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_ledger_entries_no_truncate_trg
  BEFORE TRUNCATE ON "agent_ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION agent_ledger_entries_no_truncate();

-- Document numbers through the shared Numbering Engine (never user-typed)
INSERT INTO "number_series" (
  "id", "document_type", "label", "doc_code", "template",
  "next_number", "padding", "separator",
  "year_reset", "month_reset", "day_reset", "active",
  "created_at", "updated_at"
)
VALUES
  (gen_random_uuid(), 'AGENT', 'Agent', 'AG', '{DOC}-{SEQ}', 1, 4, '-', false, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'AGENT_AGREEMENT', 'Agent Agreement', 'AGR', '{DOC}-{YEAR}-{SEQ}', 1, 4, '-', true, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'AGENT_LEDGER_ENTRY', 'Agent Ledger Entry', 'AL', '{DOC}-{YEAR}-{SEQ}', 1, 6, '-', true, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'AGENT_PAYOUT', 'Agent Payout', 'APO', '{DOC}-{YEAR}-{SEQ}', 1, 5, '-', true, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'AGENT_RETURN', 'Agent Order Return', 'ART', '{DOC}-{YEAR}-{SEQ}', 1, 5, '-', true, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("document_type") DO NOTHING;
