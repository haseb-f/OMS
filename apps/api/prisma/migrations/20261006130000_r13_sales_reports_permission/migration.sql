-- Round 13 (spec E) — Sales reports get their own permission.
--
-- `/reports/sales` was an ungated Coming-soon stub; it is now a real report
-- (Live / employees / teams / comparison / payment mix) served by
-- `GET /sales-reports/*`, gated on `reports.sales.view`. The DATA scope is not
-- widened by this permission: it stays SalesScopeService (OWN / TEAM / ALL).
--
-- Who receives it (decision O-6 — confirm before deploying to Production):
-- every not-deleted INTERNAL user who already holds the Reports section key
-- `reports.view`, so nobody who could open the Reports section loses the
-- page. Additive and idempotent; never removes a grant. Agent users never
-- hold internal permissions (they read `/agent-portal/sales-reports/*`).
--
-- Reverse with: DELETE FROM user_permissions WHERE permission_id =
-- (SELECT id FROM permissions WHERE name = 'reports.sales.view')
-- AND created_by IS NULL AND created_at >= '2026-10-06'.
INSERT INTO "permissions" ("id", "name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), 'reports.sales.view', 'Permission Matrix: reports.sales.view', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."name" = 'reports.sales.view');

INSERT INTO "user_permissions" ("id", "user_id", "permission_id", "created_at")
SELECT gen_random_uuid(), u."id", target."id", CURRENT_TIMESTAMP
FROM "users" u
CROSS JOIN (
  SELECT "id" FROM "permissions" WHERE "name" = 'reports.sales.view'
) target
WHERE u."deleted_at" IS NULL
  AND u."user_type" = 'INTERNAL'
  AND EXISTS (
    SELECT 1
    FROM "user_permissions" held
    JOIN "permissions" hp ON hp."id" = held."permission_id"
    WHERE held."user_id" = u."id"
      AND hp."name" = 'reports.view'
  )
ON CONFLICT ("user_id", "permission_id") DO NOTHING;
