-- CreateEnum
CREATE TYPE "ShippingSyncBehavior" AS ENUM ('UNDER_SYNC', 'FINAL');

-- AlterTable: additive, safe default — every existing row becomes UNDER_SYNC
-- (unchanged sync behavior) until explicitly reviewed/promoted below or by
-- an administrator through the Shipping Status screen.
ALTER TABLE "shipping_statuses" ADD COLUMN     "sync_behavior" "ShippingSyncBehavior" NOT NULL DEFAULT 'UNDER_SYNC';

-- Documented business evidence only (never guessed from a name alone): the
-- "Shipping Status Configuration + Final-Shipment Sync Rules" spec names
-- تم التسليم (DELIVERED) explicitly as a FINAL example. Flip ONLY that
-- seeded status — every other existing status (including any
-- administrator-created ones) stays UNDER_SYNC, unchanged.
UPDATE "shipping_statuses" SET "sync_behavior" = 'FINAL' WHERE "code" = 'DELIVERED';

-- Backfill safety net for the "exactly one active default" rule below: an
-- environment can only reach zero active defaults through unusual manual
-- data edits (the seed always sets READY_FOR_SHIPPING.isDefault = true). If
-- that ever happened, deterministically promote the oldest active status
-- (lowest sortOrder, then earliest createdAt) rather than leave the
-- invariant broken or guess silently.
UPDATE "shipping_statuses" SET "is_default" = true
WHERE "deleted_at" IS NULL
  AND "id" = (
    SELECT "id" FROM "shipping_statuses"
    WHERE "deleted_at" IS NULL
    ORDER BY "sort_order" ASC, "created_at" ASC
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM "shipping_statuses" WHERE "is_default" = true AND "deleted_at" IS NULL
  );

-- DropIndex: `name` was globally unique; the spec requires uniqueness
-- scoped to ACTIVE statuses only (archiving a status frees its name for
-- reuse) — same pattern as product_categories_name_active_key.
DROP INDEX "shipping_statuses_name_key";

-- CreateIndex: name unique among active (non-archived) rows only.
CREATE UNIQUE INDEX "shipping_statuses_name_active_key" ON "shipping_statuses"("name") WHERE "deleted_at" IS NULL;

-- CreateIndex: exactly one ACTIVE default status, enforced at the database
-- level (not just the service layer) so two concurrent "set as default"
-- requests can never both leave a row flagged is_default = true.
CREATE UNIQUE INDEX "shipping_statuses_single_default_key" ON "shipping_statuses"("is_default") WHERE "is_default" = true AND "deleted_at" IS NULL;
