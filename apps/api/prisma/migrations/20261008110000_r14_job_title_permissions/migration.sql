-- R14 W2 (spec-2 §A, decision D2-1) — job-title permission templates with
-- individual overrides, inside the ONE existing resolver:
--   effective(user) = (template(user.jobTitle) ∪ GRANTs) − DENYs
--
-- Parity: every template starts EMPTY and every existing user_permissions row
-- becomes an individual GRANT (column default), so no user's effective set
-- changes (proved by scripts/r14/w2-permission-parity.ts on a clone). The only
-- additions are the two administration keys below, granted to the people who
-- could already do this through settings.manage (no broadening).
--
-- Reverse with: DROP TABLE job_title_permissions; DELETE FROM user_permissions
-- WHERE effect = 'DENY'; ALTER TABLE user_permissions DROP COLUMN effect;
-- ALTER TABLE users DROP COLUMN permissions_review_required; DROP TYPE
-- "PermissionEffect"; and delete the two permission rows below.

CREATE TYPE "PermissionEffect" AS ENUM ('GRANT', 'DENY');

ALTER TABLE "user_permissions" ADD COLUMN "effect" "PermissionEffect" NOT NULL DEFAULT 'GRANT';

ALTER TABLE "users" ADD COLUMN "permissions_review_required" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "job_title_permissions" (
    "id" UUID NOT NULL,
    "job_title_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "job_title_permissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_title_permissions_permission_id_idx" ON "job_title_permissions"("permission_id");

CREATE UNIQUE INDEX "job_title_permissions_job_title_id_permission_id_key" ON "job_title_permissions"("job_title_id", "permission_id");

CREATE INDEX "user_permissions_permission_id_effect_idx" ON "user_permissions"("permission_id", "effect");

ALTER TABLE "job_title_permissions" ADD CONSTRAINT "job_title_permissions_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "job_title_permissions" ADD CONSTRAINT "job_title_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Administration keys (spec-2 §A "Authorization of administration").
INSERT INTO "permissions" ("id", "name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), v.name, 'Permission Matrix: ' || v.name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES ('job-titles.manage_permissions'), ('users.manage_permissions')) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."name" = v.name);

INSERT INTO "user_permissions" ("id", "user_id", "permission_id", "created_at", "effect")
SELECT gen_random_uuid(), u."id", target."id", CURRENT_TIMESTAMP, 'GRANT'
FROM "users" u
CROSS JOIN (
  SELECT "id" FROM "permissions"
  WHERE "name" IN ('job-titles.manage_permissions', 'users.manage_permissions')
) target
WHERE u."user_type" = 'INTERNAL'
  AND EXISTS (
    SELECT 1
    FROM "user_permissions" held
    JOIN "permissions" hp ON hp."id" = held."permission_id"
    WHERE held."user_id" = u."id"
      AND hp."name" = 'settings.manage'
  )
ON CONFLICT ("user_id", "permission_id") DO NOTHING;
