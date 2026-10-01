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

-- 3. Holders of an existing granular setup key → THAT domain's view only
--    (plus the `settings.view` section key). Explicit mapping, generated from
--    `SETTINGS_DOMAIN_MODULES` and asserted equal to it by
--    `settings-domain-permissions.spec.ts`. `settings.view` alone maps to
--    General so its holders keep the General pages they could open before.
WITH setup_key(name, domain) AS (VALUES
  ('settings.view', 'general'),
  ('masterdata.departments.view', 'general'),
  ('masterdata.departments.create', 'general'),
  ('masterdata.departments.edit', 'general'),
  ('masterdata.departments.archive', 'general'),
  ('masterdata.job-titles.view', 'general'),
  ('masterdata.job-titles.create', 'general'),
  ('masterdata.job-titles.edit', 'general'),
  ('masterdata.job-titles.archive', 'general'),
  ('numbering.manage', 'general'),
  ('masterdata.payment-methods.view', 'finance'),
  ('masterdata.payment-methods.create', 'finance'),
  ('masterdata.payment-methods.edit', 'finance'),
  ('masterdata.payment-methods.archive', 'finance'),
  ('masterdata.payment-terms.view', 'finance'),
  ('masterdata.payment-terms.create', 'finance'),
  ('masterdata.payment-terms.edit', 'finance'),
  ('masterdata.payment-terms.archive', 'finance'),
  ('masterdata.payment-sources.view', 'finance'),
  ('masterdata.payment-sources.create', 'finance'),
  ('masterdata.payment-sources.edit', 'finance'),
  ('masterdata.payment-sources.archive', 'finance'),
  ('masterdata.currencies.view', 'finance'),
  ('masterdata.currencies.create', 'finance'),
  ('masterdata.currencies.edit', 'finance'),
  ('masterdata.currencies.archive', 'finance'),
  ('masterdata.taxes.view', 'finance'),
  ('masterdata.taxes.create', 'finance'),
  ('masterdata.taxes.edit', 'finance'),
  ('masterdata.taxes.archive', 'finance'),
  ('masterdata.journals.view', 'finance'),
  ('masterdata.journals.create', 'finance'),
  ('masterdata.journals.edit', 'finance'),
  ('masterdata.journals.archive', 'finance'),
  ('accounting.fiscal-years.manage', 'finance'),
  ('masterdata.cost-allocation-rules.view', 'finance'),
  ('masterdata.cost-allocation-rules.create', 'finance'),
  ('masterdata.cost-allocation-rules.edit', 'finance'),
  ('masterdata.cost-allocation-rules.archive', 'finance'),
  ('masterdata.cost-allocation-rules.run', 'finance'),
  ('masterdata.cost-allocation-rules.post', 'finance'),
  ('masterdata.receiving-accounts.view', 'finance'),
  ('masterdata.receiving-accounts.create', 'finance'),
  ('masterdata.receiving-accounts.edit', 'finance'),
  ('masterdata.receiving-accounts.archive', 'finance'),
  ('masterdata.shipping-companies.view', 'shipping'),
  ('masterdata.shipping-companies.create', 'shipping'),
  ('masterdata.shipping-companies.edit', 'shipping'),
  ('masterdata.shipping-companies.archive', 'shipping'),
  ('masterdata.shipping-statuses.view', 'shipping'),
  ('masterdata.shipping-statuses.create', 'shipping'),
  ('masterdata.shipping-statuses.edit', 'shipping'),
  ('masterdata.shipping-statuses.archive', 'shipping'),
  ('masterdata.fulfillment-cost-rules.view', 'shipping'),
  ('masterdata.fulfillment-cost-rules.create', 'shipping'),
  ('masterdata.fulfillment-cost-rules.edit', 'shipping'),
  ('masterdata.fulfillment-cost-rules.archive', 'shipping'),
  ('masterdata.cost-components.view', 'costs'),
  ('masterdata.cost-components.create', 'costs'),
  ('masterdata.cost-components.edit', 'costs'),
  ('masterdata.cost-components.archive', 'costs'),
  ('masterdata.customer-classifications.view', 'crm'),
  ('masterdata.customer-classifications.create', 'crm'),
  ('masterdata.customer-classifications.edit', 'crm'),
  ('masterdata.customer-classifications.archive', 'crm'),
  ('masterdata.no-purchase-reasons.view', 'crm'),
  ('masterdata.no-purchase-reasons.create', 'crm'),
  ('masterdata.no-purchase-reasons.edit', 'crm'),
  ('masterdata.no-purchase-reasons.archive', 'crm'),
  ('masterdata.lead-follow-up-types.view', 'crm'),
  ('masterdata.lead-follow-up-types.create', 'crm'),
  ('masterdata.lead-follow-up-types.edit', 'crm'),
  ('masterdata.lead-follow-up-types.archive', 'crm'),
  ('masterdata.workflow-statuses.view', 'crm'),
  ('masterdata.workflow-statuses.create', 'crm'),
  ('masterdata.workflow-statuses.edit', 'crm'),
  ('masterdata.workflow-statuses.archive', 'crm'),
  ('masterdata.workflow-transitions.view', 'crm'),
  ('masterdata.workflow-transitions.manage', 'crm')
)
INSERT INTO "user_permissions" ("id", "user_id", "permission_id", "created_at")
SELECT DISTINCT ON (granted."user_id", target."id")
  gen_random_uuid(), granted."user_id", target."id", CURRENT_TIMESTAMP
FROM "user_permissions" granted
JOIN "permissions" source ON source."id" = granted."permission_id"
JOIN setup_key ON setup_key.name = source."name"
JOIN "users" u ON u."id" = granted."user_id" AND u."user_type" = 'INTERNAL'
JOIN "permissions" target
  ON target."name" IN ('settings.' || setup_key.domain || '.view', 'settings.view')
ON CONFLICT ("user_id", "permission_id") DO NOTHING;
