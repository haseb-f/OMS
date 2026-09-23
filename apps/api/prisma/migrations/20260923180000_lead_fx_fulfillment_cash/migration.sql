-- Lead distribution run diagnostics
ALTER TABLE "lead_distribution_states"
  ADD COLUMN IF NOT EXISTS "last_run_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_run_assigned" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_failure_code" TEXT,
  ADD COLUMN IF NOT EXISTS "last_failure_message" TEXT;

-- Exchange rate source + convention metadata
ALTER TABLE "exchange_rates"
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "provider" TEXT;

-- Fulfillment method: Shipping vs Pickup (independent of payment)
DO $$ BEGIN
  CREATE TYPE "StoreOrderFulfillmentMethod" AS ENUM ('SHIPPING', 'PICKUP');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "store_orders"
  ADD COLUMN IF NOT EXISTS "fulfillment_method" "StoreOrderFulfillmentMethod" NOT NULL DEFAULT 'SHIPPING';

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "fulfillment_method" "StoreOrderFulfillmentMethod";

CREATE INDEX IF NOT EXISTS "store_orders_fulfillment_method_idx"
  ON "store_orders"("fulfillment_method");

-- Pickup fulfillment statuses (order-level StatusDefinition codes)
INSERT INTO "status_definitions" (
  "id", "workflow_type", "code", "name", "name_en", "color",
  "sort_order", "is_system", "is_final", "is_default", "updated_at"
)
SELECT gen_random_uuid(), 'FULFILLMENT', v.code, v.name, v.name_en, v.color,
       v.sort_order, true, v.is_final, false, CURRENT_TIMESTAMP
FROM (VALUES
  ('AWAITING_PREPARATION', 'بانتظار التجهيز', 'Awaiting Preparation', 'info', 10, false),
  ('READY_FOR_PICKUP', 'جاهز للاستلام', 'Ready for Pickup', 'info', 11, false),
  ('COLLECTED', 'تم الاستلام', 'Collected', 'success', 12, false)
) AS v(code, name, name_en, color, sort_order, is_final)
WHERE NOT EXISTS (
  SELECT 1 FROM "status_definitions" sd
  WHERE sd."workflow_type" = 'FULFILLMENT' AND sd."code" = v.code
);
