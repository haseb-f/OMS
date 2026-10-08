-- R15 (decision D15-14) — a company partner's own login.
--
-- * UserType PARTNER + users.company_partner_id (unique: one login per
--   partner). A PARTNER user holds only `partner.*` permissions and reaches
--   only `@PartnerPortal()` handlers scoped to its own partner.
-- * Permissions: partner.dashboard.view / partner.statement.view (given to a
--   partner login when it is created), company-partners.users.manage
--   (internal: create / link / disable partner logins) — granted to nobody
--   (super admin bypasses), exactly like the other company-partners keys.
--
-- The enum value is only added here (never used in this migration). Additive.
-- Reverse with: ALTER TABLE users DROP COLUMN company_partner_id; DELETE the
-- three permissions (the enum value stays; unused).

-- AlterEnum
ALTER TYPE "UserType" ADD VALUE 'PARTNER';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "company_partner_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "users_company_partner_id_key" ON "users"("company_partner_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_partner_id_fkey" FOREIGN KEY ("company_partner_id") REFERENCES "company_partner_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permissions (catalog modules `partner-portal`, `company-partners`).
INSERT INTO "permissions" ("id", "name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), p.name, 'Permission Matrix: ' || p.name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('partner.dashboard.view'),
  ('partner.statement.view'),
  ('company-partners.users.manage')
) AS p(name)
WHERE NOT EXISTS (SELECT 1 FROM "permissions" existing WHERE existing."name" = p.name);
