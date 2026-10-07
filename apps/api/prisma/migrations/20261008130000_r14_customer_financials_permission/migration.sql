-- Round 14 (W4, spec-4) — customer discovery and customer history.
--
-- 1. `global_lookup_audits.outcome_detail`: what an audited lookup disclosed.
--    An authorized advanced lookup (`customers.lookup_advanced`) now shows the
--    full name, full phone and latest order (owner decision D4-1) and records
--    `FULL_DISCLOSURE` here. Nullable, additive; older rows stay NULL.
ALTER TABLE "global_lookup_audits" ADD COLUMN IF NOT EXISTS "outcome_detail" TEXT;

-- 2. `customers.view_financials`: the payments / outstanding-balance section
--    of the customer history (`GET /customers/:partnerId/history`). Granted
--    to every not-deleted INTERNAL user who already holds `finance.view`, so
--    nobody who could see a customer's money loses it. Additive and
--    idempotent; never removes a grant. Agent users never hold it.
--
-- Reverse with: DELETE FROM user_permissions WHERE permission_id =
-- (SELECT id FROM permissions WHERE name = 'customers.view_financials')
-- AND created_by IS NULL AND created_at >= '2026-10-08';
INSERT INTO "permissions" ("id", "name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), 'customers.view_financials', 'Permission Matrix: customers.view_financials', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."name" = 'customers.view_financials');

INSERT INTO "user_permissions" ("id", "user_id", "permission_id", "created_at")
SELECT gen_random_uuid(), u."id", target."id", CURRENT_TIMESTAMP
FROM "users" u
CROSS JOIN (
  SELECT "id" FROM "permissions" WHERE "name" = 'customers.view_financials'
) target
WHERE u."deleted_at" IS NULL
  AND u."user_type" = 'INTERNAL'
  AND EXISTS (
    SELECT 1
    FROM "user_permissions" held
    JOIN "permissions" hp ON hp."id" = held."permission_id"
    WHERE held."user_id" = u."id"
      AND hp."name" = 'finance.view'
  )
ON CONFLICT ("user_id", "permission_id") DO NOTHING;
