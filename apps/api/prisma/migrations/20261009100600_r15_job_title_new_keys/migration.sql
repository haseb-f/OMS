-- R15 (review L1) — job-title templates receive the two new keys exactly where
-- individual holders did (20261009100000 / 20261009100100 granted them only to
-- users with individual GRANT rows):
--
-- * shipping.receive_returns — templates that hold shipping.edit or shipping.manage
--   (the people who record failed deliveries receive the goods back);
-- * sales.receipts.reverse — templates that hold sales.receipts.cancel.
--
-- Users inheriting those templates gain the key through the template (an
-- individual DENY still wins). Additive and idempotent.
-- Reverse with: DELETE FROM job_title_permissions WHERE permission_id IN
-- (SELECT id FROM permissions WHERE name IN ('shipping.receive_returns', 'sales.receipts.reverse'));

INSERT INTO "job_title_permissions" ("id", "job_title_id", "permission_id", "created_at")
SELECT gen_random_uuid(), source."job_title_id", target."id", CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT jtp."job_title_id"
  FROM "job_title_permissions" jtp
  JOIN "permissions" p ON p."id" = jtp."permission_id"
  WHERE p."name" IN ('shipping.edit', 'shipping.manage')
) source
CROSS JOIN (SELECT "id" FROM "permissions" WHERE "name" = 'shipping.receive_returns') target
ON CONFLICT ("job_title_id", "permission_id") DO NOTHING;

INSERT INTO "job_title_permissions" ("id", "job_title_id", "permission_id", "created_at")
SELECT gen_random_uuid(), source."job_title_id", target."id", CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT jtp."job_title_id"
  FROM "job_title_permissions" jtp
  JOIN "permissions" p ON p."id" = jtp."permission_id"
  WHERE p."name" = 'sales.receipts.cancel'
) source
CROSS JOIN (SELECT "id" FROM "permissions" WHERE "name" = 'sales.receipts.reverse') target
ON CONFLICT ("job_title_id", "permission_id") DO NOTHING;
