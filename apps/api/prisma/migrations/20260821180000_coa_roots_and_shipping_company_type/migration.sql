-- Chart of Accounts: no schema change required for hierarchy invariants
-- (enforced in service). Shipping Company absorbs ShippingMethod.type.

ALTER TABLE "shipping_companies"
  ADD COLUMN IF NOT EXISTS "type" "ShippingMethodType" NOT NULL DEFAULT 'EXTERNAL_COMPANY';

UPDATE "shipping_companies" AS sc
SET "type" = sm."type"
FROM "shipping_methods" AS sm
WHERE sm."name" = sc."name"
  AND sm."deleted_at" IS NULL;

INSERT INTO "shipping_companies" ("id", "name", "type", "created_at", "updated_at")
SELECT gen_random_uuid(), N'توصيل داخلي', 'INTERNAL_DELIVERY', NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "shipping_companies" WHERE "name" = N'توصيل داخلي'
);

UPDATE "shipping_methods"
SET "deleted_at" = NOW()
WHERE "deleted_at" IS NULL;