-- Round 11 — order-level delivery destination. Additive, nullable: no existing
-- row changes and readers fall back to the customer's own country / city /
-- address when these are null.
ALTER TABLE "store_orders"
  ADD COLUMN "delivery_country_id" UUID,
  ADD COLUMN "delivery_city" TEXT,
  ADD COLUMN "delivery_address" TEXT;

ALTER TABLE "store_orders"
  ADD CONSTRAINT "store_orders_delivery_country_id_fkey"
  FOREIGN KEY ("delivery_country_id") REFERENCES "countries"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
