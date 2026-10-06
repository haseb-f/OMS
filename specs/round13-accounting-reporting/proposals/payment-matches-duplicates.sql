-- R13 — payment_matches duplicate ACTIVE (statement_line_id, payment_id) groups
--
-- ADOPTED (owner decision 2026-10-06, all data is test data): migration
-- 20261006120000_r13_payment_method_channel consolidates every duplicate group — the oldest ACTIVE
-- row keeps the summed amount, younger rows become REVERSED with reason "R13 consolidation: ..."
-- — and then ALWAYS creates the partial unique index "payment_matches_active_line_payment_key".
-- Totals per (line, claim) are unchanged; no journal entry is created or reversed.
--
-- Section 1 below is the read-only pre-flight / post-check. Section 2 documents the same merge
-- the migration performs (kept for audit; do not run it again).

-- ============================================================================================
-- 1. PRE-FLIGHT (read-only) — run before/after `prisma migrate deploy`
-- ============================================================================================

-- 1a. Number of duplicate groups (0 → the migration creates the index).
SELECT count(*) AS duplicate_groups
FROM (
  SELECT 1
  FROM payment_matches
  WHERE status = 'ACTIVE'
  GROUP BY statement_line_id, payment_id
  HAVING count(*) > 1
) d;

-- 1b. Detail of every duplicate group, with the line / claim context needed to review it.
SELECT
  pm.statement_line_id,
  pm.payment_id,
  p.payment_number,
  psl.amount                        AS line_amount,
  psl.matched_amount                AS line_matched_amount,
  count(*)                          AS active_rows,
  sum(pm.amount)                    AS active_total,
  array_agg(pm.id ORDER BY pm.confirmed_at, pm.id)          AS match_ids,
  array_agg(pm.amount ORDER BY pm.confirmed_at, pm.id)      AS match_amounts,
  array_agg(pm.confirmed_at ORDER BY pm.confirmed_at, pm.id) AS confirmed_at
FROM payment_matches pm
JOIN payments p                 ON p.id = pm.payment_id
JOIN payment_statement_lines psl ON psl.id = pm.statement_line_id
WHERE pm.status = 'ACTIVE'
GROUP BY pm.statement_line_id, pm.payment_id, p.payment_number, psl.amount, psl.matched_amount
HAVING count(*) > 1
ORDER BY pm.statement_line_id, pm.payment_id;

-- 1c. Index present?
SELECT indexname FROM pg_indexes
WHERE tablename = 'payment_matches' AND indexname = 'payment_matches_active_line_payment_key';

-- ============================================================================================
-- 2. OPTIONAL MERGE PROPOSAL — NOT EXECUTED. Review, approve, back up, then run manually.
-- ============================================================================================
-- Approach: keep the OLDEST active row of each group (same row the application tops up),
-- add the amounts of the younger rows to it, and mark the younger rows REVERSED with an
-- explicit reversal reason. Totals per (line, claim) are unchanged, so
-- payment_statement_lines.matched_amount, payments, receipts and journals stay consistent —
-- no journal entry is created or reversed by this merge.
--
-- BEGIN;
--
-- WITH ranked AS (
--   SELECT id, statement_line_id, payment_id, amount,
--          row_number() OVER (PARTITION BY statement_line_id, payment_id
--                             ORDER BY confirmed_at, id) AS rn,
--          count(*)    OVER (PARTITION BY statement_line_id, payment_id) AS n
--   FROM payment_matches
--   WHERE status = 'ACTIVE'
-- ),
-- extra AS (
--   SELECT statement_line_id, payment_id, sum(amount) AS extra_amount
--   FROM ranked WHERE n > 1 AND rn > 1
--   GROUP BY statement_line_id, payment_id
-- ),
-- topped AS (
--   UPDATE payment_matches pm
--   SET amount = pm.amount + e.extra_amount
--   FROM ranked r JOIN extra e USING (statement_line_id, payment_id)
--   WHERE pm.id = r.id AND r.rn = 1
--   RETURNING pm.id
-- )
-- UPDATE payment_matches pm
-- SET status = 'REVERSED',
--     reversed_at = now(),
--     reversed_by = NULL,               -- set to the approving user's id
--     reversal_reason = 'R13 merge: amount consolidated into the oldest ACTIVE match of the same line and claim'
-- FROM ranked r
-- WHERE pm.id = r.id AND r.n > 1 AND r.rn > 1;
--
-- -- Re-run 1a (expect 0), then:
-- CREATE UNIQUE INDEX "payment_matches_active_line_payment_key"
--   ON "payment_matches"("statement_line_id", "payment_id")
--   WHERE "status" = 'ACTIVE';
--
-- COMMIT;   -- or ROLLBACK after inspecting the result of 1b
