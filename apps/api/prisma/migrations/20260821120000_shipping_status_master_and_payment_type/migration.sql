-- Dynamic Shipping Status catalog + Store Order Payment Type.
-- Historical Shipment.status enum values are mapped onto seeded catalog rows.
-- Existing Store Orders default to PREPAID (does not change financial status).

CREATE TABLE "shipping_statuses" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'neutral',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_importable" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "shipping_statuses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shipping_statuses_code_key" ON "shipping_statuses"("code");
CREATE UNIQUE INDEX "shipping_statuses_name_key" ON "shipping_statuses"("name");
CREATE INDEX "shipping_statuses_deleted_at_idx" ON "shipping_statuses"("deleted_at");
CREATE UNIQUE INDEX "shipping_statuses_default_unique"
    ON "shipping_statuses" ("is_default")
    WHERE "is_default" = true AND "deleted_at" IS NULL;

INSERT INTO "shipping_statuses"
    ("id", "code", "name", "color", "is_system", "is_default", "is_importable", "sort_order", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), 'READY_FOR_SHIPPING', 'جاهز للشحن', 'neutral', true, true, false, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'LABEL_CREATED', 'تم إنشاء البوليصة', 'info', true, false, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'SHIPPED', 'تم الشحن', 'info', true, false, true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'OUT_FOR_DELIVERY', 'قيد التوصيل', 'warning', true, false, true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'DELIVERED', 'تم التسليم', 'success', true, false, true, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'DELIVERY_FAILED', 'فشل التسليم', 'destructive', true, false, true, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'NEEDS_RESHIPMENT', 'بحاجة لإعادة شحن', 'warning', true, false, true, 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "shipments" ADD COLUMN "shipping_status_id" UUID;

UPDATE "shipments" AS s
SET "shipping_status_id" = ss."id"
FROM "shipping_statuses" AS ss
WHERE s."status"::text = ss."code";

ALTER TABLE "shipments"
    ADD CONSTRAINT "shipments_shipping_status_id_fkey"
    FOREIGN KEY ("shipping_status_id") REFERENCES "shipping_statuses"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "StoreOrderPaymentType" AS ENUM ('PREPAID', 'CASH_ON_DELIVERY');

ALTER TABLE "store_orders"
    ADD COLUMN "payment_type" "StoreOrderPaymentType" NOT NULL DEFAULT 'PREPAID';
