-- CreateEnum
CREATE TYPE "CarrierChargeKind" AS ENUM ('BASE', 'SURCHARGE', 'CREDIT');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('PRODUCT', 'SERVICE');

-- CreateEnum
CREATE TYPE "AgentShippingPolicy" AS ENUM ('PREDETERMINED_CHARGE', 'FLAT_FEE_PER_SHIPMENT', 'NONE');

-- CreateEnum
CREATE TYPE "AgentCommissionClass" AS ENUM ('PRODUCT', 'SERVICE');

-- CreateEnum
CREATE TYPE "AgentCommissionRateSource" AS ENUM ('AGREEMENT_PRODUCT', 'AGREEMENT_SERVICE', 'ITEM_OVERRIDE', 'LEGACY_SINGLE_RATE');

-- AlterTable
-- commission-policy.md A3/A9: existing agreements keep identical economics —
-- the service rate equals their single legacy rate and the flat per-shipment
-- fee stays their shipping policy. New agreements state both explicitly.
ALTER TABLE "agent_agreements" ADD COLUMN "service_commission_rate_percent" DECIMAL(7,4),
ADD COLUMN "shipping_policy" "AgentShippingPolicy";
UPDATE "agent_agreements"
   SET "service_commission_rate_percent" = "commission_rate_percent",
       "shipping_policy" = 'FLAT_FEE_PER_SHIPMENT';
ALTER TABLE "agent_agreements" ALTER COLUMN "service_commission_rate_percent" SET NOT NULL,
ALTER COLUMN "shipping_policy" SET NOT NULL;

-- AlterTable
ALTER TABLE "carrier_charges" ADD COLUMN     "charge_kind" "CarrierChargeKind" NOT NULL DEFAULT 'BASE',
ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "paid_by" UUID,
ADD COLUMN     "paid_reference" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN "item_type" "ItemType";
-- commission-policy.md A2: classify only what is reliable. Existing SERVICE
-- products are services; stocked items are products. Every other item stays
-- NULL (unclassified) and is listed for review — never guessed.
UPDATE "products" SET "item_type" = 'SERVICE' WHERE "type" = 'SERVICE';
UPDATE "products" SET "item_type" = 'PRODUCT'
 WHERE "item_type" IS NULL AND "is_inventory_item" = true;

-- CreateTable
CREATE TABLE "agent_product_commission_overrides" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "rate_percent" DECIMAL(7,4) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "ended_at" TIMESTAMP(3),
    "ended_by" UUID,

    CONSTRAINT "agent_product_commission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_commission_lines" (
    "id" UUID NOT NULL,
    "ledger_entry_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "store_order_id" UUID NOT NULL,
    "store_order_item_id" UUID,
    "product_id" UUID NOT NULL,
    "commission_class" "AgentCommissionClass",
    "rate_source" "AgentCommissionRateSource" NOT NULL,
    "rate_percent" DECIMAL(7,4) NOT NULL,
    "override_id" UUID,
    "sales_amount" DECIMAL(14,2) NOT NULL,
    "returned_before_earning" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "base_amount" DECIMAL(14,2) NOT NULL,
    "returned_after_earning" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_commission_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_product_commission_overrides_product_id_effective_fro_idx" ON "agent_product_commission_overrides"("product_id", "effective_from");

-- CreateIndex
CREATE INDEX "agent_product_commission_overrides_agent_id_idx" ON "agent_product_commission_overrides"("agent_id");

-- CreateIndex
CREATE INDEX "agent_commission_lines_ledger_entry_id_idx" ON "agent_commission_lines"("ledger_entry_id");

-- CreateIndex
CREATE INDEX "agent_commission_lines_agent_id_store_order_id_idx" ON "agent_commission_lines"("agent_id", "store_order_id");

-- AddForeignKey
ALTER TABLE "agent_product_commission_overrides" ADD CONSTRAINT "agent_product_commission_overrides_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_product_commission_overrides" ADD CONSTRAINT "agent_product_commission_overrides_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_commission_lines" ADD CONSTRAINT "agent_commission_lines_ledger_entry_id_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "agent_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_commission_lines" ADD CONSTRAINT "agent_commission_lines_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_commission_lines" ADD CONSTRAINT "agent_commission_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity guards (commission-policy.md A3-A5)
ALTER TABLE "agent_agreements" ADD CONSTRAINT "agent_agreements_service_rate_chk" CHECK (
  "service_commission_rate_percent" >= 0 AND "service_commission_rate_percent" <= 100
);
-- Predetermined shipping: customer shipping belongs to the company and settles
-- the agent charge; no second per-shipment fee. NONE never keeps a fee it
-- would not charge.
ALTER TABLE "agent_agreements" ADD CONSTRAINT "agent_agreements_shipping_policy_chk" CHECK (
  ("shipping_policy" <> 'PREDETERMINED_CHARGE'
    OR ("customer_shipping_charge_owner" = 'COMPANY' AND "shipping_fee_per_shipment" = 0))
  AND ("shipping_policy" <> 'NONE' OR "shipping_fee_per_shipment" = 0)
);
ALTER TABLE "agent_product_commission_overrides" ADD CONSTRAINT "agent_product_commission_overrides_chk" CHECK (
  "rate_percent" >= 0 AND "rate_percent" <= 100
  AND ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);
ALTER TABLE "agent_commission_lines" ADD CONSTRAINT "agent_commission_lines_amounts_chk" CHECK (
  "rate_percent" >= 0 AND "rate_percent" <= 100 AND "amount" >= 0 AND "base_amount" >= 0
);

-- Commission lines are append-only (like the ledger they detail).
CREATE OR REPLACE FUNCTION agent_commission_lines_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'agent_commission_lines is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_commission_lines_guard_trg
  BEFORE UPDATE OR DELETE ON "agent_commission_lines"
  FOR EACH ROW EXECUTE FUNCTION agent_commission_lines_guard();
