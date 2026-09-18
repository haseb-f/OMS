-- AlterEnum
ALTER TYPE "LeadDistributionMode" ADD VALUE 'MANUAL';
ALTER TYPE "LeadDistributionMode" ADD VALUE 'PAUSED';

-- AlterTable
ALTER TABLE "leads" ADD COLUMN "distribution_held" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "leads_distribution_held_import_batch_idx" ON "leads"("distribution_held", "import_batch");
