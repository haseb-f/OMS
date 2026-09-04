-- Sales flow hardening: customer classifications, no-purchase reasons,
-- Lead close/classification FKs, StoreOrderItem.agreedAmount, sort indexes.

CREATE TABLE "customer_classifications" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'neutral',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "customer_classifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_classifications_code_key" ON "customer_classifications"("code");
CREATE INDEX "customer_classifications_deleted_at_is_active_sort_order_idx" ON "customer_classifications"("deleted_at", "is_active", "sort_order");

CREATE TABLE "no_purchase_reasons" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "no_purchase_reasons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "no_purchase_reasons_code_key" ON "no_purchase_reasons"("code");
CREATE INDEX "no_purchase_reasons_deleted_at_is_active_sort_order_idx" ON "no_purchase_reasons"("deleted_at", "is_active", "sort_order");

CREATE TABLE "_ClassificationSuggestedReasons" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_ClassificationSuggestedReasons_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_ClassificationSuggestedReasons_B_index" ON "_ClassificationSuggestedReasons"("B");

ALTER TABLE "_ClassificationSuggestedReasons" ADD CONSTRAINT "_ClassificationSuggestedReasons_A_fkey" FOREIGN KEY ("A") REFERENCES "customer_classifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ClassificationSuggestedReasons" ADD CONSTRAINT "_ClassificationSuggestedReasons_B_fkey" FOREIGN KEY ("B") REFERENCES "no_purchase_reasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "leads"
    ADD COLUMN "customer_classification_id" UUID,
    ADD COLUMN "no_purchase_reason_id" UUID,
    ADD COLUMN "close_notes" TEXT;

CREATE INDEX IF NOT EXISTS "leads_created_at_idx" ON "leads"("created_at");
CREATE INDEX "leads_customer_classification_id_idx" ON "leads"("customer_classification_id");
CREATE INDEX "leads_no_purchase_reason_id_idx" ON "leads"("no_purchase_reason_id");

ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_classification_id_fkey" FOREIGN KEY ("customer_classification_id") REFERENCES "customer_classifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_no_purchase_reason_id_fkey" FOREIGN KEY ("no_purchase_reason_id") REFERENCES "no_purchase_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "store_order_items" ADD COLUMN "agreed_amount" DECIMAL(12,2);

UPDATE "store_order_items"
SET "agreed_amount" = ROUND(("quantity"::numeric * "unit_price"), 2)
WHERE "agreed_amount" IS NULL;

ALTER TABLE "store_order_items" ALTER COLUMN "agreed_amount" SET NOT NULL;

INSERT INTO "number_series" (
    "id", "document_type", "label", "doc_code", "template",
    "next_number", "padding", "separator",
    "year_reset", "month_reset", "day_reset", "active",
    "created_at", "updated_at"
)
SELECT gen_random_uuid(), 'CUSTOMER_CLASSIFICATION', 'Customer Classification', 'CC', '{DOC}-{SEQ}',
    1, 6, '-', false, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "number_series" WHERE "document_type" = 'CUSTOMER_CLASSIFICATION');

INSERT INTO "number_series" (
    "id", "document_type", "label", "doc_code", "template",
    "next_number", "padding", "separator",
    "year_reset", "month_reset", "day_reset", "active",
    "created_at", "updated_at"
)
SELECT gen_random_uuid(), 'NO_PURCHASE_REASON', 'No Purchase Reason', 'NPR', '{DOC}-{SEQ}',
    1, 6, '-', false, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "number_series" WHERE "document_type" = 'NO_PURCHASE_REASON');
