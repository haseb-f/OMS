-- CreateEnum
CREATE TYPE "CarrierReconciliationState" AS ENUM ('UNMATCHED', 'MATCHED', 'REVIEW_REQUIRED', 'CONFIRMED');

-- CreateTable
CREATE TABLE "carrier_charge_imports" (
    "id" UUID NOT NULL,
    "fileName" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_by" UUID,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "matched_rows" INTEGER NOT NULL DEFAULT 0,
    "review_rows" INTEGER NOT NULL DEFAULT 0,
    "unmatched_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicate_rows" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "carrier_charge_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_charges" (
    "id" UUID NOT NULL,
    "import_id" UUID,
    "carrier_name_raw" TEXT NOT NULL,
    "shipping_company_id" UUID,
    "carrier_reference" TEXT,
    "tracking_number" TEXT,
    "shipment_reference" TEXT,
    "charge_amount" DECIMAL(12,2) NOT NULL,
    "currency_id" UUID NOT NULL,
    "charge_date" DATE NOT NULL,
    "charge_type" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "shipment_id" UUID,
    "reconciliation_state" "CarrierReconciliationState" NOT NULL DEFAULT 'UNMATCHED',
    "matched_at" TIMESTAMP(3),
    "matched_by" UUID,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "carrier_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "carrier_charges_dedupe_key_key" ON "carrier_charges"("dedupe_key");

-- CreateIndex
CREATE INDEX "carrier_charges_shipment_id_idx" ON "carrier_charges"("shipment_id");

-- CreateIndex
CREATE INDEX "carrier_charges_reconciliation_state_idx" ON "carrier_charges"("reconciliation_state");

-- CreateIndex
CREATE INDEX "carrier_charges_import_id_idx" ON "carrier_charges"("import_id");

-- AddForeignKey
ALTER TABLE "carrier_charges" ADD CONSTRAINT "carrier_charges_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "carrier_charge_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_charges" ADD CONSTRAINT "carrier_charges_shipping_company_id_fkey" FOREIGN KEY ("shipping_company_id") REFERENCES "shipping_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_charges" ADD CONSTRAINT "carrier_charges_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_charges" ADD CONSTRAINT "carrier_charges_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
