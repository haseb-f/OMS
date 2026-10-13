-- R20 stream A — LOCAL demo clone only (oms_r20_a). Adds a sales-team manager persona so the
-- «لم يُفتح» journey can show the manager's view. Idempotent. Never run against oms or Production.
--
--   docker exec -i oms-postgres psql -U oms -d oms_r20_a < scripts/acceptance/r20/r20-a-seed-demo-manager.sql
--
-- manager@oms-demo.local is a copy of sales@oms-demo.local (same job title, same demo password hash,
-- not distribution-eligible) and manages team R20-DEMO-TEAM = sales + sales2 @oms-demo.local, so its
-- sales scope is TEAM (own + members' leads).

INSERT INTO "users"
SELECT (jsonb_populate_record(
  NULL::"users",
  to_jsonb(u) || jsonb_build_object(
    'id', gen_random_uuid(),
    'email', 'manager@oms-demo.local',
    'username', 'manager-demo',
    'full_name', 'مدير المبيعات (تجريبي)',
    'sales_distribution_eligible', false,
    'company_partner_id', NULL,
    'created_at', now(),
    'updated_at', now()
  )
)).*
FROM "users" AS u
WHERE u."email" = 'sales@oms-demo.local'
  AND NOT EXISTS (SELECT 1 FROM "users" WHERE "email" = 'manager@oms-demo.local');

INSERT INTO "sales_teams" ("id", "code", "name", "department_id", "manager_id", "updated_at")
SELECT gen_random_uuid(), 'R20-DEMO-TEAM', 'فريق المبيعات التجريبي (R20)', t."department_id", m."id", now()
FROM "sales_teams" AS t, "users" AS m
WHERE t."code" = 'TEAM-SALES-1' AND m."email" = 'manager@oms-demo.local'
  AND NOT EXISTS (SELECT 1 FROM "sales_teams" WHERE "code" = 'R20-DEMO-TEAM');

INSERT INTO "sales_team_members" ("id", "sales_team_id", "user_id")
SELECT gen_random_uuid(), t."id", u."id"
FROM "sales_teams" AS t, "users" AS u
WHERE t."code" = 'R20-DEMO-TEAM' AND u."email" IN ('sales@oms-demo.local', 'sales2@oms-demo.local')
  AND NOT EXISTS (
    SELECT 1 FROM "sales_team_members" AS s WHERE s."sales_team_id" = t."id" AND s."user_id" = u."id"
  );

SELECT u."email", t."code" AS "manages"
FROM "sales_teams" AS t JOIN "users" AS u ON u."id" = t."manager_id"
WHERE t."code" = 'R20-DEMO-TEAM';
