-- Company-wide Department Master Data + Sales Teams.
-- User.department (free text) is migrated to User.departmentId (FK).

CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");
CREATE INDEX "departments_deleted_at_is_active_sort_order_idx" ON "departments"("deleted_at", "is_active", "sort_order");

CREATE TABLE "sales_teams" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department_id" UUID NOT NULL,
    "manager_id" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sales_teams_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_teams_code_key" ON "sales_teams"("code");
CREATE INDEX "sales_teams_department_id_idx" ON "sales_teams"("department_id");
CREATE INDEX "sales_teams_manager_id_idx" ON "sales_teams"("manager_id");

CREATE TABLE "sales_team_members" (
    "id" UUID NOT NULL,
    "sales_team_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "sales_team_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_team_members_sales_team_id_user_id_key" ON "sales_team_members"("sales_team_id", "user_id");
CREATE INDEX "sales_team_members_user_id_idx" ON "sales_team_members"("user_id");

ALTER TABLE "sales_teams" ADD CONSTRAINT "sales_teams_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_teams" ADD CONSTRAINT "sales_teams_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_team_members" ADD CONSTRAINT "sales_team_members_sales_team_id_fkey" FOREIGN KEY ("sales_team_id") REFERENCES "sales_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_team_members" ADD CONSTRAINT "sales_team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill Departments from distinct non-empty User.department text.
INSERT INTO "departments" ("id", "code", "name", "sort_order", "is_active", "updated_at")
SELECT
    gen_random_uuid(),
    'DEPT-' || LPAD(ROW_NUMBER() OVER (ORDER BY LOWER(TRIM(u."department")))::text, 4, '0'),
    TRIM(u."department"),
    0,
    true,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT TRIM("department") AS "department"
    FROM "users"
    WHERE "department" IS NOT NULL AND TRIM("department") <> ''
) u;

ALTER TABLE "users" ADD COLUMN "department_id" UUID;

UPDATE "users" u
SET "department_id" = d."id"
FROM "departments" d
WHERE u."department" IS NOT NULL
  AND TRIM(u."department") <> ''
  AND d."name" = TRIM(u."department");

ALTER TABLE "users" DROP COLUMN "department";

ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "users_department_id_idx" ON "users"("department_id");
