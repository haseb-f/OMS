/*
  Warnings:

  - You are about to drop the column `product_name` on the `leads` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "leads" DROP COLUMN "product_name",
ADD COLUMN     "possible_duplicate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "product_id" UUID;
