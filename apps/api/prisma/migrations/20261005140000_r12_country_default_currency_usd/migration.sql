-- R12: the currency an order proposes for a country (Country.default_currency_id).
-- Owner rule: Saudi Arabia -> SAR, Egypt -> EGP, every other country -> USD.
-- This is an ORDER PROPOSAL only; it never changes the system's base (functional)
-- currency, which is a Settings value (posting_settings.functional_currency_id).
-- Only runs for currencies that exist; idempotent; editable afterwards in Master data.
UPDATE "countries" SET "default_currency_id" = (
  SELECT "id" FROM "currencies" WHERE "code" = 'SAR' AND "deleted_at" IS NULL LIMIT 1
) WHERE "code" = 'SA' AND EXISTS (
  SELECT 1 FROM "currencies" WHERE "code" = 'SAR' AND "deleted_at" IS NULL
);

UPDATE "countries" SET "default_currency_id" = (
  SELECT "id" FROM "currencies" WHERE "code" = 'EGP' AND "deleted_at" IS NULL LIMIT 1
) WHERE "code" = 'EG' AND EXISTS (
  SELECT 1 FROM "currencies" WHERE "code" = 'EGP' AND "deleted_at" IS NULL
);

UPDATE "countries" SET "default_currency_id" = (
  SELECT "id" FROM "currencies" WHERE "code" = 'USD' AND "deleted_at" IS NULL LIMIT 1
) WHERE "code" NOT IN ('SA', 'EG') AND EXISTS (
  SELECT 1 FROM "currencies" WHERE "code" = 'USD' AND "deleted_at" IS NULL
);
