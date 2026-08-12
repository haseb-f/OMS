-- CreateEnum
CREATE TYPE "StoreOrderActivitySource" AS ENUM ('MANUAL', 'BULK', 'IMPORT', 'GOOGLE_SHEETS');

-- AlterEnum
ALTER TYPE "SyncSourceType" ADD VALUE 'SHIPPING_UPDATES';

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "last_external_sync_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "store_order_activities" ADD COLUMN     "source" "StoreOrderActivitySource" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "sync_source_configs" ADD COLUMN     "is_syncing" BOOLEAN NOT NULL DEFAULT false;
