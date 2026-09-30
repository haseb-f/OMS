-- Round 5 Spec 1B — order duplicate warning + idempotent order submission.
-- Additive only: no existing column or row value is changed.
--
-- Phone matching deliberately keeps the existing in-memory E.164
-- normalization (`PartnersService.lookupAllByPhone`) instead of a new
-- normalized-phone column, so no Partner phone is rewritten or backfilled.

-- CreateEnum
CREATE TYPE "StoreOrderDuplicateReviewStatus" AS ENUM ('NONE', 'PENDING', 'CONFIRMED_DISTINCT', 'CONFIRMED_DUPLICATE');

-- AlterTable
ALTER TABLE "store_orders" ADD COLUMN     "creation_idempotency_key" TEXT,
ADD COLUMN     "creation_payload_hash" TEXT,
ADD COLUMN     "duplicate_review_note" TEXT,
ADD COLUMN     "duplicate_review_status" "StoreOrderDuplicateReviewStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "duplicate_reviewed_at" TIMESTAMP(3),
ADD COLUMN     "duplicate_reviewed_by_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "store_orders_creation_idempotency_key_key" ON "store_orders"("creation_idempotency_key");

-- CreateIndex
CREATE INDEX "store_orders_duplicate_review_status_created_at_idx" ON "store_orders"("duplicate_review_status", "created_at");

-- AddForeignKey
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_duplicate_reviewed_by_id_fkey" FOREIGN KEY ("duplicate_reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permission catalog row (same shape `provision-permissions.ts` upserts).
INSERT INTO "permissions" ("id", "name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), 'store-orders.duplicate_review', 'Permission Matrix: store-orders.duplicate_review', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "name" = 'store-orders.duplicate_review');

-- Reviewers: every user who already manages all store orders
-- (`store-orders.manage`, cross-owner browse + edit) may resolve reviews.
INSERT INTO "user_permissions" ("id", "user_id", "permission_id", "created_at")
SELECT gen_random_uuid(), granted."user_id", review."id", CURRENT_TIMESTAMP
FROM "user_permissions" granted
JOIN "permissions" manage ON manage."id" = granted."permission_id" AND manage."name" = 'store-orders.manage'
CROSS JOIN "permissions" review
WHERE review."name" = 'store-orders.duplicate_review'
ON CONFLICT ("user_id", "permission_id") DO NOTHING;
