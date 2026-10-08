-- R15 (decision D15-13) — the agent shipping agreement becomes its own
-- document (agent → settings): agent_shipping_agreements (number, currency,
-- effective dates, DRAFT / ACTIVE / INACTIVE) + agent_shipping_agreement_rates
-- (explicit service × destination → agreed charge). The commission agreement
-- keeps only its shipping policy.
--
-- Data: every commission agreement that held tariff rows gets one shipping
-- agreement with the same agent, currency and dates ("ASA-" + its number):
-- DRAFT → DRAFT, ACTIVE → ACTIVE, ENDED → ACTIVE with its end date (a closed
-- window, still in force for orders dated inside it). Each old row's ANY
-- channel / payment wildcard is expanded into the explicit services it
-- covered; when several rows cover the same service + destination the most
-- specific one wins (exact channel 2, exact payment 1) — exactly the old
-- resolver's choice, so every order priced from now on gets the same charge.
-- Orders already priced keep their frozen snapshot (never repriced).
-- The old table and its two enums are dropped afterwards.
--
-- Reverse: not automatic (the old table is dropped) — restore
-- agent_shipping_rates from a backup taken before this migration.

-- CreateEnum
CREATE TYPE "AgentShippingAgreementStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AgentShippingService" AS ENUM ('PREPAID_CARRIER', 'COD_CARRIER', 'COD_INTERNAL_COURIER', 'PREPAID_INTERNAL_COURIER');

-- CreateTable
CREATE TABLE "agent_shipping_agreements" (
    "id" UUID NOT NULL,
    "agreement_number" TEXT NOT NULL,
    "agent_id" UUID NOT NULL,
    "currency_id" UUID NOT NULL,
    "status" "AgentShippingAgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "notes" TEXT,
    "supersedes_id" UUID,
    "activated_at" TIMESTAMP(3),
    "activated_by" UUID,
    "deactivated_at" TIMESTAMP(3),
    "deactivated_by" UUID,
    "deactivation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "agent_shipping_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_shipping_agreement_rates" (
    "id" UUID NOT NULL,
    "shipping_agreement_id" UUID NOT NULL,
    "service" "AgentShippingService" NOT NULL,
    "country_id" UUID,
    "city" TEXT NOT NULL DEFAULT '',
    "destination_key" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "agent_shipping_agreement_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_shipping_agreements_agreement_number_key" ON "agent_shipping_agreements"("agreement_number");
CREATE UNIQUE INDEX "agent_shipping_agreements_supersedes_id_key" ON "agent_shipping_agreements"("supersedes_id");
CREATE INDEX "agent_shipping_agreements_agent_id_status_effective_from_idx" ON "agent_shipping_agreements"("agent_id", "status", "effective_from");
CREATE UNIQUE INDEX "agent_shipping_agreement_rates_shipping_agreement_id_servic_key" ON "agent_shipping_agreement_rates"("shipping_agreement_id", "service", "destination_key");

-- AddForeignKey
ALTER TABLE "agent_shipping_agreements" ADD CONSTRAINT "agent_shipping_agreements_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_shipping_agreements" ADD CONSTRAINT "agent_shipping_agreements_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_shipping_agreements" ADD CONSTRAINT "agent_shipping_agreements_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "agent_shipping_agreements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_shipping_agreement_rates" ADD CONSTRAINT "agent_shipping_agreement_rates_shipping_agreement_id_fkey" FOREIGN KEY ("shipping_agreement_id") REFERENCES "agent_shipping_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_shipping_agreement_rates" ADD CONSTRAINT "agent_shipping_agreement_rates_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: one shipping agreement per commission agreement that holds tariff rows.
INSERT INTO "agent_shipping_agreements" (
  "id", "agreement_number", "agent_id", "currency_id", "status",
  "effective_from", "effective_to", "notes",
  "activated_at", "activated_by", "created_at", "updated_at", "created_by", "updated_by"
)
SELECT gen_random_uuid(), 'ASA-' || a."agreement_number", a."agent_id", a."currency_id",
       CASE a."status" WHEN 'DRAFT' THEN 'DRAFT'::"AgentShippingAgreementStatus" ELSE 'ACTIVE'::"AgentShippingAgreementStatus" END,
       a."effective_from",
       CASE WHEN a."status" = 'ENDED'
            -- ended_at is a UTC timestamp without zone: read it as UTC, then take its Cairo business date.
            THEN COALESCE(a."effective_to", ((a."ended_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Cairo')::date)
            ELSE a."effective_to" END,
       'Migrated from the tariff of agreement ' || a."agreement_number",
       a."activated_at", a."activated_by", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, a."created_by", a."updated_by"
FROM "agent_agreements" a
WHERE EXISTS (SELECT 1 FROM "agent_shipping_rates" r WHERE r."agreement_id" = a."id");

-- Data: the explicit service rows (ANY expanded, most specific source row wins).
INSERT INTO "agent_shipping_agreement_rates" (
  "id", "shipping_agreement_id", "service", "country_id", "city", "destination_key",
  "amount", "created_at", "updated_at"
)
SELECT gen_random_uuid(), picked.sa_id, picked.service, picked.country_id, picked.city,
       picked.country_id::text || CASE WHEN picked.city <> '' THEN '|' || lower(picked.city) ELSE '' END,
       picked.amount, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON (sa."id", r."country_id", lower(r."city"), s.service)
         sa."id" AS sa_id, s.service, r."country_id", r."city", r."amount"
  FROM "agent_shipping_rates" r
  JOIN "agent_agreements" a ON a."id" = r."agreement_id"
  JOIN "agent_shipping_agreements" sa ON sa."agreement_number" = 'ASA-' || a."agreement_number"
  JOIN (VALUES
    ('PREPAID_CARRIER'::"AgentShippingService", 'CARRIER', 'PREPAID'),
    ('COD_CARRIER'::"AgentShippingService", 'CARRIER', 'CASH_ON_DELIVERY'),
    ('COD_INTERNAL_COURIER'::"AgentShippingService", 'INTERNAL_COURIER', 'CASH_ON_DELIVERY'),
    ('PREPAID_INTERNAL_COURIER'::"AgentShippingService", 'INTERNAL_COURIER', 'PREPAID')
  ) AS s(service, channel, payment)
    ON (r."delivery_channel"::text IN ('ANY', s.channel))
   AND (r."payment_type"::text IN ('ANY', s.payment))
  ORDER BY sa."id", r."country_id", lower(r."city"), s.service,
           (CASE WHEN r."delivery_channel"::text <> 'ANY' THEN 2 ELSE 0 END
            + CASE WHEN r."payment_type"::text <> 'ANY' THEN 1 ELSE 0 END) DESC
) picked;

-- Old tariff rows and their enums.
ALTER TABLE "agent_shipping_rates" DROP CONSTRAINT "agent_shipping_rates_agreement_id_fkey";
ALTER TABLE "agent_shipping_rates" DROP CONSTRAINT "agent_shipping_rates_country_id_fkey";
DROP TABLE "agent_shipping_rates";
DROP TYPE "AgentShippingDeliveryChannel";
DROP TYPE "AgentShippingPaymentType";

-- Shipping agreement numbers ("ASA-2026-0001") — never typed by hand.
INSERT INTO "number_series" (
  "id", "document_type", "label", "doc_code", "template",
  "next_number", "padding", "separator",
  "year_reset", "month_reset", "day_reset", "active",
  "created_at", "updated_at"
)
VALUES
  (gen_random_uuid(), 'AGENT_SHIPPING_AGREEMENT', 'Agent Shipping Agreement', 'ASA', '{DOC}-{YEAR}-{SEQ}', 1, 4, '-', true, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("document_type") DO NOTHING;
