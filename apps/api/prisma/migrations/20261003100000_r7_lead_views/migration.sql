-- R7 (workstream A) — per-employee "viewed" marker for leads.
-- Additive only: one new table. It is read state; it never touches leads.

CREATE TABLE IF NOT EXISTS "lead_views" (
    "lead_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_views_pkey" PRIMARY KEY ("lead_id","user_id")
);

CREATE INDEX IF NOT EXISTS "lead_views_user_id_idx" ON "lead_views"("user_id");

ALTER TABLE "lead_views" ADD CONSTRAINT "lead_views_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_views" ADD CONSTRAINT "lead_views_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Leads the assigned employee already opened before this marker existed
-- (first_opened_at is set by the existing first-open flow) start as viewed,
-- so a rollout does not light up every historical lead as "new to you".
INSERT INTO "lead_views" ("lead_id", "user_id", "viewed_at")
SELECT l."id", l."sales_employee_id", l."first_opened_at"
FROM "leads" AS l
WHERE l."first_opened_at" IS NOT NULL AND l."sales_employee_id" IS NOT NULL
ON CONFLICT DO NOTHING;
