-- R17 (owner brief 2026-10-11, specs/round17-refinements/README.md §2 + §3).
--
-- §2 Editable, versioned agent agreements (commission + shipping):
--   * active_from / active_to — instant bounds inside the existing day range
--     (effective_from / effective_to stay for planned, day-dated versions). A
--     version is in force at t when active_from <= t < active_to; null = the
--     day bound alone.
--   * version_number + (commission) supersedes_id — the version chain.
--   Backfill: every activated agreement gets active_from = the first instant
--   of its effective_from day in the day convention that agreement already
--   resolves by (commission: UTC calendar day; shipping: Cairo business day),
--   so resolution of every existing order date is exactly unchanged.
--   activated_at is deliberately not used as the bound: back-dated orders
--   priced inside the range before the activation instant would otherwise
--   lose their agreement. active_to stays null (the day bound already closes
--   ended / replaced agreements). Shipping replacement chains (supersedes_id,
--   R15 "replace from date") get version numbers 1, 2, 3 … along the chain.
--
-- §3 Shipping rates + COD collection fee:
--   * AgentShippingService gains ANY (the agreement's default row: every
--     service, and — with no country — every destination).
--   * agent_shipping_agreements.cod_collection_fee (nullable = no fee).
--   * agent_shipping_agreement_rates.cod_fee ADDED | INCLUDED. Existing
--     COD-service rows become INCLUDED (their amount was all-inclusive and is
--     never charged again); every other row is ADDED. No existing agreement
--     has a fee, so no charge changes; orders keep their frozen snapshots.
--
-- Idempotent: every DDL is guarded; the cod_fee backfill runs only in the
-- run that adds the column (a later re-run never overwrites a user's choice).
--
-- Reverse (manual): DROP the added columns, the AgentShippingCodFeeMode type
-- and the agent_agreements supersedes index / FK. The ANY enum value cannot be
-- removed in place; delete ANY rows first if a rollback is ever required.

-- §3 — the ANY service (first, so it sorts before the concrete services).
ALTER TYPE "AgentShippingService" ADD VALUE IF NOT EXISTS 'ANY' BEFORE 'PREPAID_CARRIER';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentShippingCodFeeMode') THEN
    CREATE TYPE "AgentShippingCodFeeMode" AS ENUM ('ADDED', 'INCLUDED');
  END IF;
END $$;

-- §2 — commission agreement versions.
ALTER TABLE "agent_agreements"
  ADD COLUMN IF NOT EXISTS "active_from" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "active_to" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "version_number" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "supersedes_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "agent_agreements_supersedes_id_key"
  ON "agent_agreements"("supersedes_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_agreements_supersedes_id_fkey'
  ) THEN
    ALTER TABLE "agent_agreements"
      ADD CONSTRAINT "agent_agreements_supersedes_id_fkey"
      FOREIGN KEY ("supersedes_id") REFERENCES "agent_agreements"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- §2/§3 — shipping agreement versions + COD collection fee.
ALTER TABLE "agent_shipping_agreements"
  ADD COLUMN IF NOT EXISTS "active_from" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "active_to" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "version_number" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "cod_collection_fee" DECIMAL(12,2);

-- §3 — per-row COD fee mode; existing COD-service rows are all-inclusive.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_shipping_agreement_rates' AND column_name = 'cod_fee'
  ) THEN
    ALTER TABLE "agent_shipping_agreement_rates"
      ADD COLUMN "cod_fee" "AgentShippingCodFeeMode" NOT NULL DEFAULT 'ADDED';
    UPDATE "agent_shipping_agreement_rates"
      SET "cod_fee" = 'INCLUDED'
      WHERE "service"::text IN ('COD_CARRIER', 'COD_INTERNAL_COURIER');
  END IF;
END $$;

-- §2 backfill — activated commission agreements: UTC day start (their convention).
UPDATE "agent_agreements"
  SET "active_from" = "effective_from"::timestamp
  WHERE "active_from" IS NULL
    AND "activated_at" IS NOT NULL
    AND "status" IN ('ACTIVE', 'ENDED');

-- §2 backfill — activated shipping agreements: Cairo business-day start.
UPDATE "agent_shipping_agreements"
  SET "active_from" = ("effective_from"::timestamp AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'UTC'
  WHERE "active_from" IS NULL
    AND "activated_at" IS NOT NULL
    AND "status" IN ('ACTIVE', 'INACTIVE');

-- §2 backfill — version numbers along R15 replacement chains.
WITH RECURSIVE chain AS (
  SELECT "id", 1 AS "v"
  FROM "agent_shipping_agreements"
  WHERE "supersedes_id" IS NULL
  UNION ALL
  SELECT a."id", c."v" + 1
  FROM "agent_shipping_agreements" a
  JOIN chain c ON a."supersedes_id" = c."id"
)
UPDATE "agent_shipping_agreements" a
  SET "version_number" = chain."v"
  FROM chain
  WHERE a."id" = chain."id" AND a."version_number" <> chain."v";
