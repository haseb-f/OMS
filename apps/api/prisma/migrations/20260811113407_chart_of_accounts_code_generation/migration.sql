-- AlterTable
ALTER TABLE "chart_of_accounts" ADD COLUMN     "allows_posting" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "level" INTEGER NOT NULL DEFAULT 1;
