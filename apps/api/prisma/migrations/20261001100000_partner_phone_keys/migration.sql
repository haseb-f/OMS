-- Owner decision O3 (2026-10-01) — one phone number = one customer.
-- Additive only: a new key table; no existing column or row is changed.
-- Existing partners are keyed by prisma/scripts/backfill-partner-phone-keys.ts
-- (oldest record wins; duplicates are reported, never merged).

-- CreateEnum
CREATE TYPE "PartnerPhoneKind" AS ENUM ('PHONE', 'MOBILE');

-- CreateTable
CREATE TABLE "partner_phone_keys" (
    "phone_e164" TEXT NOT NULL,
    "partner_id" UUID NOT NULL,
    "kind" "PartnerPhoneKind" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_phone_keys_pkey" PRIMARY KEY ("phone_e164")
);

-- CreateIndex
CREATE INDEX "partner_phone_keys_partner_id_idx" ON "partner_phone_keys"("partner_id");

-- AddForeignKey — deferred so a create can claim the number before the
-- partner row is inserted in the same transaction; a key is derived data of
-- its partner (partners are only soft-deleted in the app, which releases
-- the keys explicitly), so a hard delete takes the key with it.
ALTER TABLE "partner_phone_keys" ADD CONSTRAINT "partner_phone_keys_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
