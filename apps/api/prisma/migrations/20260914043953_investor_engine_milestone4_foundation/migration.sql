-- CreateEnum
CREATE TYPE "InvestorPortalAccountStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED');

-- AlterTable
ALTER TABLE "investor_profiles" ADD COLUMN     "investor_type_id" UUID;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "available_for_investment_opportunities" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "investor_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "investor_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investor_portal_accounts" (
    "id" UUID NOT NULL,
    "investor_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "status" "InvestorPortalAccountStatus" NOT NULL DEFAULT 'INVITED',
    "invited_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "invited_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investor_portal_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investor_portal_activation_tokens" (
    "id" UUID NOT NULL,
    "portal_account_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investor_portal_activation_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "investor_types_code_key" ON "investor_types"("code");

-- CreateIndex
CREATE INDEX "investor_types_deleted_at_is_active_sort_order_idx" ON "investor_types"("deleted_at", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "investor_portal_accounts_investor_id_key" ON "investor_portal_accounts"("investor_id");

-- CreateIndex
CREATE UNIQUE INDEX "investor_portal_accounts_email_key" ON "investor_portal_accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "investor_portal_activation_tokens_token_hash_key" ON "investor_portal_activation_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "investor_profiles_investor_type_id_idx" ON "investor_profiles"("investor_type_id");

-- AddForeignKey
ALTER TABLE "investor_profiles" ADD CONSTRAINT "investor_profiles_investor_type_id_fkey" FOREIGN KEY ("investor_type_id") REFERENCES "investor_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_portal_accounts" ADD CONSTRAINT "investor_portal_accounts_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_portal_accounts" ADD CONSTRAINT "investor_portal_accounts_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_portal_activation_tokens" ADD CONSTRAINT "investor_portal_activation_tokens_portal_account_id_fkey" FOREIGN KEY ("portal_account_id") REFERENCES "investor_portal_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Numbering series for InvestorType.code (same idempotent pattern every
-- other Master Data series migration uses).
INSERT INTO "number_series" (
    "id", "document_type", "label", "doc_code", "template",
    "next_number", "padding", "separator",
    "year_reset", "month_reset", "day_reset", "active",
    "created_at", "updated_at"
)
SELECT gen_random_uuid(), 'INVESTOR_TYPE', 'Investor Type', 'IT', '{DOC}-{SEQ}',
    1, 6, '-', false, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "number_series" WHERE "document_type" = 'INVESTOR_TYPE');

-- Seed default Investor Types (examples only, per the mission spec — the
-- business can rename/deactivate/add more from Investor Settings). Codes are
-- hand-picked here (not Numbering-Engine-generated) purely because this is a
-- one-time migration seed, not a user-initiated create.
INSERT INTO "investor_types" ("id", "code", "name", "name_en", "sort_order", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, v.name_ar, v.name_en, v.sort_order, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
    ('IT-000001', 'فرد', 'Individual', 0),
    ('IT-000002', 'شركة', 'Company', 1),
    ('IT-000003', 'مؤسسة', 'Institution', 2),
    ('IT-000004', 'مكتب عائلي', 'Family Office', 3),
    ('IT-000005', 'صندوق استثماري', 'Fund', 4)
) AS v(code, name_ar, name_en, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM "investor_types" WHERE "code" = v.code);

-- Advance the series past the seeded rows so the next Admin-created row
-- doesn't collide with IT-000001..IT-000005.
UPDATE "number_series" SET "next_number" = 6 WHERE "document_type" = 'INVESTOR_TYPE' AND "next_number" < 6;

-- Backfill: an existing Investor's Partner.entityType is a reasonable
-- historical default (PERSON -> Individual, ORGANIZATION -> Company) so
-- newly-visible Investor Type columns aren't blank for every pre-existing
-- record. Never overwrites a value that already exists (there is none yet,
-- but this keeps the migration safely re-runnable).
UPDATE "investor_profiles" ip
SET "investor_type_id" = it."id"
FROM "partners" p, "investor_types" it
WHERE ip."partner_id" = p."id"
  AND ip."investor_type_id" IS NULL
  AND p."entity_type" = 'PERSON'
  AND it."code" = 'IT-000001';

UPDATE "investor_profiles" ip
SET "investor_type_id" = it."id"
FROM "partners" p, "investor_types" it
WHERE ip."partner_id" = p."id"
  AND ip."investor_type_id" IS NULL
  AND p."entity_type" = 'ORGANIZATION'
  AND it."code" = 'IT-000002';

-- Grandfather every Product already referenced by an existing
-- OpportunityProduct as investment-eligible, so no historical Opportunity's
-- Product picker silently loses data (mission Part B #10). Every other
-- Product defaults to FALSE (the column default already covers new rows).
UPDATE "products" p
SET "available_for_investment_opportunities" = true
WHERE EXISTS (
    SELECT 1 FROM "opportunity_products" op WHERE op."product_id" = p."id"
);
