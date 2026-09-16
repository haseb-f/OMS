-- CreateEnum
CREATE TYPE "FulfillmentCostSource" AS ENUM ('STANDARD', 'ACTUAL');

-- AlterTable
ALTER TABLE "payment_sources" ADD COLUMN     "fee_fixed_amount" DECIMAL(12,2),
ADD COLUMN     "fee_percentage" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "actual_fee_amount" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "direct_fulfillment_cost_rules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "cost_amount" DECIMAL(12,2) NOT NULL,
    "currency_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" DATE,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "direct_fulfillment_cost_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_order_fulfillment_costs" (
    "id" UUID NOT NULL,
    "store_order_id" UUID NOT NULL,
    "rule_id" UUID,
    "rule_name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "source" "FulfillmentCostSource" NOT NULL DEFAULT 'STANDARD',
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "store_order_fulfillment_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "direct_fulfillment_cost_rules_deleted_at_is_active_idx" ON "direct_fulfillment_cost_rules"("deleted_at", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "store_order_fulfillment_costs_store_order_id_key" ON "store_order_fulfillment_costs"("store_order_id");

-- AddForeignKey
ALTER TABLE "direct_fulfillment_cost_rules" ADD CONSTRAINT "direct_fulfillment_cost_rules_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order_fulfillment_costs" ADD CONSTRAINT "store_order_fulfillment_costs_store_order_id_fkey" FOREIGN KEY ("store_order_id") REFERENCES "store_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order_fulfillment_costs" ADD CONSTRAINT "store_order_fulfillment_costs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "direct_fulfillment_cost_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
