-- CreateEnum
CREATE TYPE "SyncSourceType" AS ENUM ('LEADS', 'STORE_ORDERS', 'CASH_FLOW');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('NEVER_RUN', 'SUCCESS', 'PARTIAL', 'FAILED');

-- AlterTable
ALTER TABLE "bank_transactions" ADD COLUMN     "import_job_id" UUID;

-- AlterTable
ALTER TABLE "import_jobs" ADD COLUMN     "row_defaults" JSONB;

-- CreateTable
CREATE TABLE "sync_source_configs" (
    "id" UUID NOT NULL,
    "source_type" "SyncSourceType" NOT NULL,
    "label" TEXT NOT NULL,
    "spreadsheet_id" TEXT NOT NULL,
    "worksheet_gid" TEXT,
    "worksheet_name" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "import_job_id" UUID,
    "last_synced_at" TIMESTAMP(3),
    "last_sync_status" "SyncRunStatus" NOT NULL DEFAULT 'NEVER_RUN',
    "last_sync_user_id" UUID,
    "last_sync_summary" JSONB,
    "config_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sync_source_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sync_source_configs_import_job_id_key" ON "sync_source_configs"("import_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_source_configs_source_type_spreadsheet_id_worksheet_gi_key" ON "sync_source_configs"("source_type", "spreadsheet_id", "worksheet_gid");

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_source_configs" ADD CONSTRAINT "sync_source_configs_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
