-- R6 (specs/ui-navigation-r6/spec.md A.3) — Settings permissions by domain.
-- Additive only: creates the 12 `settings.<domain>.view|manage` catalog rows
-- and grants them to EXISTING internal users. No grant is removed and every
-- existing granular key keeps working (domain keys are resolved in addition,
-- see `withSettingsDomainGrants` in permission-catalog.ts). Idempotent.

-- 1. Catalog rows (same shape `provision-permissions.ts` upserts).
INSERT INTO "permissions" ("id", "name", "description", "created_at", "updated_at")
SELECT gen_random_uuid(), name, 'Permission Matrix: ' || name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('settings.view'),
  ('settings.general.view'), ('settings.general.manage'),
  ('settings.finance.view'), ('settings.finance.manage'),
  ('settings.shipping.view'), ('settings.shipping.manage'),
  ('settings.costs.view'), ('settings.costs.manage'),
  ('settings.crm.view'), ('settings.crm.manage'),
  ('settings.integrations.view'), ('settings.integrations.manage')
) AS catalog(name)
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."name" = catalog.name);

-- 2. Full settings administrators (`settings.manage`) → every domain's
--    view + manage (internal users only; agents never hold internal setup).
--    Safe because domain keys never grant postings or period control.
INSERT INTO "user_permissions" ("id", "user_id", "permission_id", "created_at")
SELECT gen_random_uuid(), granted."user_id", domain_key."id", CURRENT_TIMESTAMP
FROM "user_permissions" granted
JOIN "permissions" source ON source."id" = granted."permission_id" AND source."name" = 'settings.manage'
JOIN "users" u ON u."id" = granted."user_id" AND u."user_type" = 'INTERNAL'
CROSS JOIN "permissions" domain_key
WHERE domain_key."name" IN (
  'settings.general.view', 'settings.general.manage',
  'settings.finance.view', 'settings.finance.manage',
  'settings.shipping.view', 'settings.shipping.manage',
  'settings.costs.view', 'settings.costs.manage',
  'settings.crm.view', 'settings.crm.manage',
  'settings.integrations.view', 'settings.integrations.manage'
)
ON CONFLICT ("user_id", "permission_id") DO NOTHING;

-- 3. Preservation only — never a widening. Existing granular keys keep
--    opening their own pages (nav gates are any-of), so nothing is granted for
--    them. The only pages that were reachable WITHOUT a granular key and are
--    now gated on a domain key are the General pages (company, numbering
--    view, print, notifications, security, backup) and Integrations; they
--    were opened through the Settings section (`settings.view`). Those users
--    get exactly the two view keys needed to keep opening them. The formerly
--    ungated Finance setup pages (fiscal periods, year closing, accounting
--    settings) need no grant: their nav gate also accepts the accountants'
--    existing ledger keys (see navigation-map.md).
INSERT INTO "user_permissions" ("id", "user_id", "permission_id", "created_at")
SELECT gen_random_uuid(), granted."user_id", target."id", CURRENT_TIMESTAMP
FROM "user_permissions" granted
JOIN "permissions" source ON source."id" = granted."permission_id" AND source."name" = 'settings.view'
JOIN "users" u ON u."id" = granted."user_id" AND u."user_type" = 'INTERNAL'
CROSS JOIN "permissions" target
WHERE target."name" IN ('settings.general.view', 'settings.integrations.view')
ON CONFLICT ("user_id", "permission_id") DO NOTHING;
