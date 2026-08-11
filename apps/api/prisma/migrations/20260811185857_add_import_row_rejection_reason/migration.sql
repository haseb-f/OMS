-- AlterTable
ALTER TABLE "import_job_errors" ADD COLUMN     "rejected_at" TIMESTAMP(3),
ADD COLUMN     "rejection_reason_code" TEXT,
ADD COLUMN     "rejection_reason_note" TEXT;
