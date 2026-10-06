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
-- Pre-R13 data may already hold two ACTIVE rows for the same (line, claim) — two partial
-- confirms. Historical matches are never merged or rewritten here: when such groups exist the
-- index is skipped with a WARNING and the application (findFirst top-up) keeps tolerating them.
-- Pre-flight query + a reviewable merge proposal:
-- specs/round13-accounting-reporting/proposals/payment-matches-duplicates.sql
DO $$
DECLARE
  dup_groups integer;
BEGIN
  SELECT count(*) INTO dup_groups
  FROM (
    SELECT 1 FROM "payment_matches"
    WHERE "status" = 'ACTIVE'
    GROUP BY "statement_line_id", "payment_id"
    HAVING count(*) > 1
  ) d;

  IF dup_groups = 0 THEN
    CREATE UNIQUE INDEX "payment_matches_active_line_payment_key"
      ON "payment_matches"("statement_line_id", "payment_id")
      WHERE "status" = 'ACTIVE';
  ELSE
    RAISE WARNING 'payment_matches_active_line_payment_key NOT created: % duplicate ACTIVE (statement_line_id, payment_id) group(s) exist. Review specs/round13-accounting-reporting/proposals/payment-matches-duplicates.sql, then create the index manually.', dup_groups;
  END IF;
END $$;
