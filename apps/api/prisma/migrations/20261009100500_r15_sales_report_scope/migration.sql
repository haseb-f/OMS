-- R15 (decision D15-18) — sales-report visibility. `reports.sales.view_all` is
-- the one key that opens company-wide sales reports and rankings; browse keys
-- (store-orders.view_all) and the lead-management key (crm.leads.manage) no
-- longer widen reports. Without it a user sees only their own figures and own
-- rank; a sales-team manager sees their team.
--
-- Parity: today a user sees company-wide sales figures (sales reports page
-- with reports.sales.view, and the home dashboard ranking / KPIs) when they
-- resolve to the ALL sales scope. The deliberate company-wide sales managers —
-- holders of crm.leads.manage (by grant or by job title, not denied) who manage
-- no active team — receive reports.sales.view_all, so nobody who manages sales
-- loses a company-wide figure (the reports page itself still needs
-- reports.sales.view, so nobody gains that page). Holders of only
-- store-orders.view_all (an order-browse key) do not: their figures narrow to
-- their own (and team) figures, which is the point of the change.
--
-- Additive. Reverse with: DELETE FROM user_permissions WHERE permission_id =
-- (SELECT id FROM permissions WHERE name = 'reports.sales.view_all');
-- DELETE the permission.

INSERT INTO "permissions" ("id", "name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), 'reports.sales.view_all', 'Permission Matrix: reports.sales.view_all', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."name" = 'reports.sales.view_all');

WITH effective AS (
  -- individual grants
  SELECT up."user_id", p."name"
  FROM "user_permissions" up
  JOIN "permissions" p ON p."id" = up."permission_id"
  WHERE up."effect" = 'GRANT'
  UNION
  -- job-title template (inherited) unless individually denied
  SELECT u."id", p."name"
  FROM "users" u
  JOIN "job_title_permissions" jtp ON jtp."job_title_id" = u."job_title_id"
  JOIN "permissions" p ON p."id" = jtp."permission_id"
  WHERE NOT EXISTS (
    SELECT 1 FROM "user_permissions" d
    WHERE d."user_id" = u."id" AND d."permission_id" = p."id" AND d."effect" = 'DENY'
  )
)
INSERT INTO "user_permissions" ("id", "user_id", "permission_id", "created_at", "effect")
SELECT gen_random_uuid(), u."id", target."id", CURRENT_TIMESTAMP, 'GRANT'
FROM "users" u
CROSS JOIN (SELECT "id" FROM "permissions" WHERE "name" = 'reports.sales.view_all') target
WHERE u."user_type" = 'INTERNAL'
  AND u."deleted_at" IS NULL
  AND EXISTS (SELECT 1 FROM effective e WHERE e."user_id" = u."id" AND e."name" = 'crm.leads.manage')
  AND NOT EXISTS (
    SELECT 1 FROM "sales_teams" t
    WHERE t."manager_id" = u."id" AND t."is_active" = true AND t."deleted_at" IS NULL
  )
ON CONFLICT ("user_id", "permission_id") DO NOTHING;
