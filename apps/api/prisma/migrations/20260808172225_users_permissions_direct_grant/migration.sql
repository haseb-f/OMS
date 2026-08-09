-- TASK-060 — Users & Permissions: replace Role-mediated RBAC (Role/UserRole/
-- RolePermission) with direct User<->Permission grants, and add the Users
-- form's new fields (username, mobile, department, lock/force-password,
-- Job Title, Branch).

-- CreateTable: JobTitle (a closed label list — never joined into permission checks)
CREATE TABLE "job_titles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_titles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_titles_name_key" ON "job_titles"("name");

-- CreateTable: UserPermission (direct grant — the only permission-grant table from here on)
CREATE TABLE "user_permissions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_permissions_user_id_permission_id_key" ON "user_permissions"("user_id", "permission_id");

ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: users — new fields (username is nullable at first so existing rows can be backfilled)
ALTER TABLE "users"
  ADD COLUMN "username" TEXT,
  ADD COLUMN "mobile" TEXT,
  ADD COLUMN "department" TEXT,
  ADD COLUMN "is_locked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "job_title_id" UUID,
  ADD COLUMN "branch_id" UUID;

-- Backfill username from the email local-part for existing rows, deduplicated.
UPDATE "users" SET "username" = split_part("email", '@', 1) WHERE "username" IS NULL;
UPDATE "users" SET "username" = "username" || '-' || substr("id"::text, 1, 8)
  WHERE "id" IN (
    SELECT "id" FROM (
      SELECT "id", ROW_NUMBER() OVER (PARTITION BY "username" ORDER BY "created_at") AS rn
      FROM "users"
    ) ranked WHERE rn > 1
  );

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

ALTER TABLE "users" ADD CONSTRAINT "users_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_titles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropTable: the old Role-mediated RBAC layer (FK-safe order)
ALTER TABLE "role_permissions" DROP CONSTRAINT IF EXISTS "role_permissions_role_id_fkey";
ALTER TABLE "role_permissions" DROP CONSTRAINT IF EXISTS "role_permissions_permission_id_fkey";
ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "user_roles_user_id_fkey";
ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "user_roles_role_id_fkey";

DROP TABLE "role_permissions";
DROP TABLE "user_roles";
DROP TABLE "roles";
