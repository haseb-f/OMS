-- Round 5 Spec 1A — order amendments until delivery.
-- Additive only: no existing column or row value is changed.

-- CreateEnum
CREATE TYPE "StoreOrderAmendmentActorType" AS ENUM ('INTERNAL', 'AGENT');

-- AlterTable: optimistic concurrency on the order.
ALTER TABLE "store_orders" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: a label issued before an amendment must be reissued.
ALTER TABLE "shipments" ADD COLUMN     "label_reissue_requested_at" TIMESTAMP(3),
ADD COLUMN     "label_reissue_requested_by_id" UUID,
ADD COLUMN     "label_reissue_required" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: append-only amendment audit.
CREATE TABLE "store_order_amendments" (
    "id" UUID NOT NULL,
    "store_order_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" UUID,
    "actor_type" "StoreOrderAmendmentActorType" NOT NULL,
    "changes" JSONB NOT NULL,
    "impacts" JSONB NOT NULL,
    "previous_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_order_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_order_amendments_store_order_id_created_at_idx" ON "store_order_amendments"("store_order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "store_order_amendments_store_order_id_version_key" ON "store_order_amendments"("store_order_id", "version");

-- AddForeignKey
ALTER TABLE "store_order_amendments" ADD CONSTRAINT "store_order_amendments_store_order_id_fkey" FOREIGN KEY ("store_order_id") REFERENCES "store_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order_amendments" ADD CONSTRAINT "store_order_amendments_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permission catalog rows (same shape `provision-permissions.ts` upserts).
INSERT INTO "permissions" ("id", "name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), 'store-orders.amend', 'Permission Matrix: store-orders.amend', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "name" = 'store-orders.amend');

INSERT INTO "permissions" ("id", "name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), 'agent.orders.edit', 'Permission Matrix: agent.orders.edit', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "name" = 'agent.orders.edit');

-- Internal: every holder of `store-orders.edit` may amend.
INSERT INTO "user_permissions" ("id", "user_id", "permission_id", "created_at")
SELECT gen_random_uuid(), granted."user_id", amend."id", CURRENT_TIMESTAMP
FROM "user_permissions" granted
JOIN "permissions" edit ON edit."id" = granted."permission_id" AND edit."name" = 'store-orders.edit'
CROSS JOIN "permissions" amend
WHERE amend."name" = 'store-orders.amend'
ON CONFLICT ("user_id", "permission_id") DO NOTHING;

-- Agent users: every agent user who may create orders (Admin and Sales
-- presets) may amend them; the record visibility (`agent.records.view_all`)
-- keeps Sales to their own orders and gives the Admin all of the agent's.
INSERT INTO "user_permissions" ("id", "user_id", "permission_id", "created_at")
SELECT gen_random_uuid(), granted."user_id", edit."id", CURRENT_TIMESTAMP
FROM "user_permissions" granted
JOIN "permissions" orders_create ON orders_create."id" = granted."permission_id" AND orders_create."name" = 'agent.orders.create'
CROSS JOIN "permissions" edit
WHERE edit."name" = 'agent.orders.edit'
ON CONFLICT ("user_id", "permission_id") DO NOTHING;
