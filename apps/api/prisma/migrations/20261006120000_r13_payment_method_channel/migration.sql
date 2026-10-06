-- R13 (spec D) — one Payment Methods area + statement matching hardening. Non-destructive:
-- no existing payment, statement line, match or journal is rewritten.

-- D1: the method's channel (PaymentSource). Nullable; declarations fall back to the default source.
ALTER TABLE "payment_methods" ADD COLUMN "payment_source_id" UUID;

ALTER TABLE "payment_methods"
  ADD CONSTRAINT "payment_methods_payment_source_id_fkey"
  FOREIGN KEY ("payment_source_id") REFERENCES "payment_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "payment_methods_payment_source_id_idx" ON "payment_methods"("payment_source_id");

-- Backfill 1: an active, non-deleted source whose name matches the method (case-insensitive, trimmed).
-- Deterministic when two active sources share a name: default first, then sort order, age, id.
UPDATE "payment_methods" pm
SET "payment_source_id" = (
  SELECT ps."id" FROM "payment_sources" ps
  WHERE ps."deleted_at" IS NULL
    AND ps."is_active" = true
    AND lower(btrim(ps."name")) = lower(btrim(pm."name"))
  ORDER BY ps."is_default" DESC, ps."sort_order", ps."created_at", ps."id"
  LIMIT 1
)
WHERE pm."payment_source_id" IS NULL
  AND EXISTS (
    SELECT 1 FROM "payment_sources" ps
    WHERE ps."deleted_at" IS NULL
      AND ps."is_active" = true
      AND lower(btrim(ps."name")) = lower(btrim(pm."name"))
  );

-- Backfill 2: otherwise the default source (the same fallback declarations already used).
UPDATE "payment_methods" pm
SET "payment_source_id" = (
  SELECT ps."id" FROM "payment_sources" ps
  WHERE ps."is_default" = true AND ps."is_active" = true AND ps."deleted_at" IS NULL
  ORDER BY ps."sort_order", ps."name"
  LIMIT 1
)
WHERE pm."payment_source_id" IS NULL;

-- D2: statement line kind. Refund / chargeback rows keep a positive amount (the existing
-- "payment_statement_lines_positive_amount" CHECK stays) and are never matched to a claim.
CREATE TYPE "PaymentStatementLineKind" AS ENUM ('PAYMENT', 'REFUND', 'CHARGEBACK');

ALTER TABLE "payment_statement_lines"
  ADD COLUMN "kind" "PaymentStatementLineKind" NOT NULL DEFAULT 'PAYMENT';

-- A non-payment line can never carry a claim allocation.
ALTER TABLE "payment_statement_lines"
  ADD CONSTRAINT "payment_statement_lines_kind_unmatched" CHECK ("kind" = 'PAYMENT' OR "matched_amount" = 0);

-- D2: one ACTIVE allocation per (statement line, claim).
-- Pre-R13 data may hold two ACTIVE rows for one (line, claim) — two partial confirms. Owner
-- decision (2026-10-06, test data): consolidate them, then ALWAYS enforce the index. The oldest
-- ACTIVE row of each group (the row the application tops up) receives the sum of the group; the
-- younger rows become REVERSED with an explicit reason. Totals per (line, claim) are unchanged,
-- so payment_statement_lines.matched_amount, claims, receipts and journals stay consistent — no
-- journal entry is created or reversed. Pre-flight / audit queries:
-- specs/round13-accounting-reporting/proposals/payment-matches-duplicates.sql
DO $$
DECLARE
  merged_groups integer;
  reversed_rows integer;
BEGIN
  CREATE TEMP TABLE r13_match_ranked ON COMMIT DROP AS
  SELECT "id", "statement_line_id", "payment_id", "amount",
         row_number() OVER (PARTITION BY "statement_line_id", "payment_id" ORDER BY "confirmed_at", "id") AS rn,
         count(*)     OVER (PARTITION BY "statement_line_id", "payment_id") AS n
  FROM "payment_matches"
  WHERE "status" = 'ACTIVE';

  UPDATE "payment_matches" pm
  SET "amount" = g.total
  FROM (
    SELECT r."id", sum(all_rows."amount") AS total
    FROM r13_match_ranked r
    JOIN r13_match_ranked all_rows
      ON all_rows."statement_line_id" = r."statement_line_id" AND all_rows."payment_id" = r."payment_id"
    WHERE r.n > 1 AND r.rn = 1
    GROUP BY r."id"
  ) g
  WHERE pm."id" = g."id";
  GET DIAGNOSTICS merged_groups = ROW_COUNT;

  UPDATE "payment_matches" pm
  SET "status" = 'REVERSED',
      "reversed_at" = CURRENT_TIMESTAMP,
      "reversal_reason" = 'R13 consolidation: amount merged into the oldest ACTIVE match of the same statement line and claim'
  FROM r13_match_ranked r
  WHERE pm."id" = r."id" AND r.n > 1 AND r.rn > 1;
  GET DIAGNOSTICS reversed_rows = ROW_COUNT;

  RAISE NOTICE 'payment_matches consolidation: % group(s) merged, % row(s) marked REVERSED', merged_groups, reversed_rows;

  DROP TABLE r13_match_ranked;
END $$;

CREATE UNIQUE INDEX "payment_matches_active_line_payment_key"
  ON "payment_matches"("statement_line_id", "payment_id")
  WHERE "status" = 'ACTIVE';
