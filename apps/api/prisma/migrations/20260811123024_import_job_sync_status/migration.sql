-- AlterTable
ALTER TABLE "import_jobs" ADD COLUMN     "is_syncing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_attempted_at" TIMESTAMP(3),
ADD COLUMN     "last_synced_at" TIMESTAMP(3);
