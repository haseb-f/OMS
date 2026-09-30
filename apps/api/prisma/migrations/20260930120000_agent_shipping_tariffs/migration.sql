-- Spec 2 (Round 5) — agent shipping tariffs by delivery channel × payment
-- type × destination, and the agent order shipping pricing state. Additive
-- only: existing rates become ANY/ANY (identical resolution), existing orders
-- keep their snapshots.

-- CreateEnum
CREATE TYPE "AgentShippingDeliveryChannel" AS ENUM ('ANY', 'CARRIER', 'INTERNAL_COURIER');

-- CreateEnum
CREATE TYPE "AgentShippingPaymentType" AS ENUM ('ANY', 'PREPAID', 'CASH_ON_DELIVERY');

-- CreateEnum
CREATE TYPE "StoreOrderShippingPricingStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING_METHOD', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "StoreOrderCustomerTotalStatus" AS ENUM ('NONE', 'CONFIRMATION_REQUIRED', 'CONFIRMED');

-- AlterTable
ALTER TABLE "agent_shipping_rates" ADD COLUMN "delivery_channel" "AgentShippingDeliveryChannel" NOT NULL DEFAULT 'ANY',
ADD COLUMN "payment_type" "AgentShippingPaymentType" NOT NULL DEFAULT 'ANY';

-- DropIndex (replaced by the wider tariff key below)
DROP INDEX "agent_shipping_rates_agreement_id_country_id_city_key";

-- CreateIndex
CREATE UNIQUE INDEX "agent_shipping_rates_tariff_key" ON "agent_shipping_rates"("agreement_id", "country_id", "city", "delivery_channel", "payment_type");

-- AlterTable
ALTER TABLE "store_orders" ADD COLUMN "shipping_pricing_status" "StoreOrderShippingPricingStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
ADD COLUMN "customer_total_status" "StoreOrderCustomerTotalStatus" NOT NULL DEFAULT 'NONE';

-- Existing predetermined-charge agent orders were priced from a single
-- destination rate at submission: their fee is final.
UPDATE "store_orders"
   SET "shipping_pricing_status" = 'CONFIRMED'
 WHERE "agent_id" IS NOT NULL
   AND "agent_terms_snapshot" ->> 'shippingPolicy' = 'PREDETERMINED_CHARGE';
