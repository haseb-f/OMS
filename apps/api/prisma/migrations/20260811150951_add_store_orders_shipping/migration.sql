-- CreateEnum
CREATE TYPE "StoreOrderSource" AS ENUM ('MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "StoreOrderPaymentStatus" AS ENUM ('PAYMENT_PENDING', 'PARTIALLY_PAID', 'FULLY_PAID_RECONCILED', 'OVERPAID', 'UNMATCHED', 'PAYMENT_REVIEW');

-- CreateEnum
CREATE TYPE "StoreOrderShippingStage" AS ENUM ('NOT_READY', 'READY_FOR_SHIPPING');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ShipmentStatus" ADD VALUE 'OUT_FOR_DELIVERY';
ALTER TYPE "ShipmentStatus" ADD VALUE 'DELIVERY_FAILED';
ALTER TYPE "ShipmentStatus" ADD VALUE 'NEEDS_RESHIPMENT';

-- DropForeignKey
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_sales_order_id_fkey";

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "store_order_id" UUID;

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "store_order_id" UUID;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "store_order_id" UUID,
ALTER COLUMN "sales_order_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "store_orders" (
    "id" UUID NOT NULL,
    "internal_order_id" TEXT NOT NULL,
    "external_order_id" TEXT,
    "customer_id" UUID NOT NULL,
    "order_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "StoreOrderSource" NOT NULL DEFAULT 'MANUAL',
    "source_channel" TEXT,
    "employee_id" UUID,
    "payment_status" "StoreOrderPaymentStatus" NOT NULL DEFAULT 'PAYMENT_PENDING',
    "shipping_stage" "StoreOrderShippingStage" NOT NULL DEFAULT 'NOT_READY',
    "currency_id" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "store_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_order_items" (
    "id" UUID NOT NULL,
    "store_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "store_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_order_receipts" (
    "id" UUID NOT NULL,
    "store_order_id" UUID NOT NULL,
    "payment_id" UUID,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT,
    "mime_type" TEXT,
    "drive_file_id" TEXT,
    "drive_file_url" TEXT,
    "uploaded_by_id" UUID,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_order_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_order_activities" (
    "id" UUID NOT NULL,
    "store_order_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "performed_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_order_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_orders_internal_order_id_key" ON "store_orders"("internal_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_orders_external_order_id_key" ON "store_orders"("external_order_id");

-- CreateIndex
CREATE INDEX "store_orders_customer_id_idx" ON "store_orders"("customer_id");

-- CreateIndex
CREATE INDEX "store_orders_external_order_id_idx" ON "store_orders"("external_order_id");

-- CreateIndex
CREATE INDEX "payments_store_order_id_idx" ON "payments"("store_order_id");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_store_order_id_fkey" FOREIGN KEY ("store_order_id") REFERENCES "store_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_store_order_id_fkey" FOREIGN KEY ("store_order_id") REFERENCES "store_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order_items" ADD CONSTRAINT "store_order_items_store_order_id_fkey" FOREIGN KEY ("store_order_id") REFERENCES "store_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order_items" ADD CONSTRAINT "store_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order_receipts" ADD CONSTRAINT "store_order_receipts_store_order_id_fkey" FOREIGN KEY ("store_order_id") REFERENCES "store_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order_receipts" ADD CONSTRAINT "store_order_receipts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order_receipts" ADD CONSTRAINT "store_order_receipts_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order_activities" ADD CONSTRAINT "store_order_activities_store_order_id_fkey" FOREIGN KEY ("store_order_id") REFERENCES "store_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order_activities" ADD CONSTRAINT "store_order_activities_performed_by_id_fkey" FOREIGN KEY ("performed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_store_order_id_fkey" FOREIGN KEY ("store_order_id") REFERENCES "store_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
