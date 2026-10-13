-- R20 (stream A) — the «لم يُفتح» (unopened) lead indicator follows the ASSIGNED employee.
-- Additive and idempotent: one nullable column on leads, one new history table, a backfill that
-- only records opens the existing data proves. Nothing is dropped; lead_views (R7 per-viewer
-- marker, now retired) is read as evidence and left untouched.

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "opened_by_assignee_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "lead_assignee_opens" (
    "lead_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "first_opened_at" TIMESTAMP(3) NOT NULL,
    "last_opened_at" TIMESTAMP(3) NOT NULL,
    "open_count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "lead_assignee_opens_pkey" PRIMARY KEY ("lead_id","user_id")
);

CREATE INDEX IF NOT EXISTS "lead_assignee_opens_user_id_idx" ON "lead_assignee_opens"("user_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_assignee_opens_lead_id_fkey') THEN
    ALTER TABLE "lead_assignee_opens" ADD CONSTRAINT "lead_assignee_opens_lead_id_fkey"
      FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_assignee_opens_user_id_fkey') THEN
    ALTER TABLE "lead_assignee_opens" ADD CONSTRAINT "lead_assignee_opens_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill. Evidence of an open by a user at time T, from the data that exists today:
--   (a) lead_views (lead, user, viewed_at) — the R7 per-viewer marker (first view only);
--   (b) leads.first_opened_at — the pre-R20 first-open, recorded only for the owner of that moment.
-- An event counts as an ASSIGNEE open only when that user was the lead's assignee at T: the latest
-- lead_assignments row at or before T (the append-only assignment history), or — for a lead with no
-- assignment row at or before T — the current owner when the current assignment started at or before T.
-- A view by a manager / admin / non-owner is never turned into an open, and no open is invented.
WITH events AS (
  SELECT v."lead_id", v."user_id", v."viewed_at" AS "opened_at"
  FROM "lead_views" AS v
  UNION ALL
  SELECT l."id", NULL::uuid, l."first_opened_at"
  FROM "leads" AS l
  WHERE l."first_opened_at" IS NOT NULL
),
attributed AS (
  SELECT e."lead_id", e."opened_at",
         COALESCE(e."user_id", owner_at."assignee_id") AS "user_id",
         owner_at."assignee_id"
  FROM events AS e
  JOIN "leads" AS l ON l."id" = e."lead_id"
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      (SELECT a."assigned_to_id" FROM "lead_assignments" AS a
        WHERE a."lead_id" = e."lead_id" AND a."deleted_at" IS NULL AND a."assigned_at" <= e."opened_at"
        ORDER BY a."assigned_at" DESC LIMIT 1),
      CASE WHEN l."assigned_at" IS NULL OR l."assigned_at" <= e."opened_at" THEN l."sales_employee_id" END
    ) AS "assignee_id"
  ) AS owner_at
)
INSERT INTO "lead_assignee_opens" ("lead_id", "user_id", "first_opened_at", "last_opened_at", "open_count")
SELECT t."lead_id", t."user_id", MIN(t."opened_at"), MAX(t."opened_at"), 1
FROM attributed AS t
WHERE t."user_id" IS NOT NULL AND t."user_id" = t."assignee_id"
GROUP BY t."lead_id", t."user_id"
ON CONFLICT ("lead_id", "user_id") DO NOTHING;

-- The current assignee has opened the lead when a proven assignee open of theirs falls inside the
-- CURRENT assignment (at or after leads.assigned_at). An earlier period (A → B → A) does not count.
UPDATE "leads" AS l
SET "opened_by_assignee_at" = proof."opened_at"
FROM (
  SELECT l2."id",
         LEAST(
           (SELECT MIN(v."viewed_at") FROM "lead_views" AS v
             WHERE v."lead_id" = l2."id" AND v."user_id" = l2."sales_employee_id"
               AND (l2."assigned_at" IS NULL OR v."viewed_at" >= l2."assigned_at")),
           CASE WHEN l2."first_opened_at" IS NOT NULL
                 AND (l2."assigned_at" IS NULL OR l2."first_opened_at" >= l2."assigned_at")
                THEN l2."first_opened_at" END
         ) AS "opened_at"
  FROM "leads" AS l2
  WHERE l2."sales_employee_id" IS NOT NULL AND l2."opened_by_assignee_at" IS NULL
) AS proof
WHERE l."id" = proof."id" AND proof."opened_at" IS NOT NULL AND l."opened_by_assignee_at" IS NULL;
