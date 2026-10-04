-- Round 7 (workstream B) — sales scope, advanced customer lookup, sales-only distribution.
-- Additive only: one boolean column, two nullable audit columns, enum values,
-- one catalog permission row (granted to nobody), and a reviewed backfill.

-- 1. Explicit Sales designation for lead distribution (default false).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sales_distribution_eligible" BOOLEAN NOT NULL DEFAULT false;

-- 2. Advanced customer lookup audit: new action/method + outcome columns.
ALTER TYPE "GlobalLookupAction" ADD VALUE IF NOT EXISTS 'ADVANCED_CUSTOMER_LOOKUP';
ALTER TYPE "GlobalLookupMethod" ADD VALUE IF NOT EXISTS 'NAME';
ALTER TABLE "global_lookup_audits" ADD COLUMN IF NOT EXISTS "result_count" INTEGER;
ALTER TABLE "global_lookup_audits" ADD COLUMN IF NOT EXISTS "outcome" TEXT;

-- 3. Catalog row for the new permission. Granted to NOBODY here: Super Admin
--    passes every check; anyone else must be granted it explicitly in the
--    Permission Matrix (it is a discovery right, never inferred from another).
INSERT INTO "permissions" ("id", "name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), 'customers.lookup_advanced', 'Permission Matrix: customers.lookup_advanced', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."name" = 'customers.lookup_advanced');

-- 4. Backfill the Sales designation (conservative; reviewed by the owner —
--    see specs/round7-grid-scope-fx/evidence-b.md). A user is flagged only if
--    ALL hold: active, not locked, not deleted, INTERNAL, currently holds
--    crm.leads.edit (so today's pool is not widened), AND has a Sales
--    footprint: member/manager of an active Sales Team, OR is in the SALES
--    department, OR holds the Sales Manager job title, OR already owns a company lead. Everyone else stays
--    false (Finance / Shipping / HR / Operations are never auto-flagged).
UPDATE "users" u
SET "sales_distribution_eligible" = true
WHERE u."deleted_at" IS NULL
  AND u."is_active" = true
  AND u."is_locked" = false
  AND u."user_type" = 'INTERNAL'
  AND EXISTS (
    SELECT 1 FROM "user_permissions" up
    JOIN "permissions" p ON p."id" = up."permission_id"
    WHERE up."user_id" = u."id" AND p."name" = 'crm.leads.edit'
  )
  AND (
    EXISTS (
      SELECT 1 FROM "sales_team_members" m
      JOIN "sales_teams" t ON t."id" = m."sales_team_id" AND t."deleted_at" IS NULL AND t."is_active" = true
      WHERE m."user_id" = u."id"
    )
    OR EXISTS (
      SELECT 1 FROM "sales_teams" t
      WHERE t."manager_id" = u."id" AND t."deleted_at" IS NULL AND t."is_active" = true
    )
    OR EXISTS (
      SELECT 1 FROM "departments" d WHERE d."id" = u."department_id" AND d."code" = 'DEPT-SALES'
    )
    OR EXISTS (
      SELECT 1 FROM "job_titles" j WHERE j."id" = u."job_title_id" AND j."code" = 'SALES_MANAGER'
    )
    -- Behavioural footprint (department / job-title CODES differ per tenant: Production's
    -- Sales department is DEPT-0001, not DEPT-SALES): anyone who already owns a company
    -- lead is doing sales work today and must not silently drop out of the pool.
    OR EXISTS (
      SELECT 1 FROM "leads" l
      WHERE l."sales_employee_id" = u."id" AND l."deleted_at" IS NULL AND l."agent_id" IS NULL
    )
  );
