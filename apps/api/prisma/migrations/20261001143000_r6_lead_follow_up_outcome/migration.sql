-- R6 (spec C1) — the lead's current follow-up classification.
-- Additive only: two nullable columns + one index, then a one-time backfill.

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "follow_up_outcome" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "follow_up_outcome_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "leads_follow_up_outcome_idx" ON "leads"("follow_up_outcome");

-- Backfill from each lead's latest follow-up that recorded an outcome of the
-- closed list (LEAD_FOLLOW_UP_OUTCOMES in src/leads/follow-up-outcomes.ts).
-- "Latest" = greatest COALESCE(completed_at, created_at); exact ties are
-- broken by created_at, then id (the runtime write in addFollowUp resolves an
-- exact tie as "latest write wins", which is the same row in practice). follow_up_at is the NEXT scheduled contact, not when
-- the contact happened, so it never orders outcomes. Legacy free-text
-- outcomes outside the list stay in history only (the lead keeps NULL).
UPDATE "leads" AS l
SET "follow_up_outcome" = latest.outcome,
    "follow_up_outcome_at" = latest.recorded_at
FROM (
  SELECT DISTINCT ON (f."lead_id")
    f."lead_id",
    f."outcome",
    COALESCE(f."completed_at", f."created_at") AS recorded_at
  FROM "lead_follow_ups" AS f
  WHERE f."deleted_at" IS NULL
    AND f."outcome" IN ('answered', 'noAnswer', 'interested', 'callback', 'wrongNumber', 'notInterested')
  ORDER BY f."lead_id",
    COALESCE(f."completed_at", f."created_at") DESC,
    f."created_at" DESC,
    f."id" DESC
) AS latest
WHERE l."id" = latest."lead_id";
