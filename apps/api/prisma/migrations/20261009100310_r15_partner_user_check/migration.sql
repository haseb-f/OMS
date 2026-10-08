-- R15 (decision D15-14) — the user affiliation check admits PARTNER logins.
-- `UserType.PARTNER` is added by 20261009100300_r15_partner_portal; a value
-- added with ALTER TYPE … ADD VALUE cannot be referenced in the same
-- transaction, so the check is replaced here, in its own migration.
--
-- PARTNER: no agent fields, never super admin. A PARTNER row may be unlinked
-- (company_partner_id NULL) — such a login cannot sign in until it is linked
-- again. INTERNAL and AGENT users never carry a company-partner link.
--
-- Reverse with: restore the check of 20260928120000_agents_fulfillment_partners
-- (after removing every PARTNER user).
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_agent_affiliation_chk";
ALTER TABLE "users" ADD CONSTRAINT "users_agent_affiliation_chk" CHECK (
  ("user_type" = 'INTERNAL' AND "agent_id" IS NULL AND "agent_role" IS NULL AND "company_partner_id" IS NULL)
  OR ("user_type" = 'AGENT' AND "agent_id" IS NOT NULL AND "agent_role" IS NOT NULL AND "is_super_admin" = false
      AND "company_partner_id" IS NULL)
  OR ("user_type" = 'PARTNER' AND "agent_id" IS NULL AND "agent_role" IS NULL AND "is_super_admin" = false)
);
