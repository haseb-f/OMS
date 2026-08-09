-- AlterTable
ALTER TABLE "import_jobs" ADD COLUMN     "schedule_config" JSONB,
ADD COLUMN     "source_url" TEXT;
