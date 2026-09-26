-- Standard Cost Components (ADR-0014 vocabulary + ADR-0017 classification).
--
-- Until now these rows were only created by prisma/seed.ts, so environments
-- provisioned by `migrate deploy` alone (Production) had none and no Landed
-- Cost document could be created. This makes them part of the deployment.
--
-- Idempotent and non-destructive: ON CONFLICT (code) DO NOTHING — an existing
-- row (same code), including any classification or name an admin already
-- customized, is never touched. No financial records, postings or accounts
-- are created; default_account_id stays NULL (AccountMappingService fallback).
--
-- Classification agreed with the owner (2026-09-26):
--   CUSTOMS, INBOUND_SHIPPING  → INVENTORY_ACQUISITION, capitalizable
--       (costs to acquire inventory; not already in the supplier's unit price).
--   PRODUCT_PREPARATION (new)  → INVENTORY_ACQUISITION, capitalizable
--       (printing/packaging that prepares a product for sale before stocking).
--   OUTBOUND_PREPARATION       → FULFILLMENT, not capitalizable (order packing).
--   PRODUCT_COST               → OTHER, not capitalizable — already in the
--       purchase-invoice price; capitalizing it again would double-count.
--   PRINTING, PACKAGING, CUSTOM_BOX, OTHER → OTHER, not capitalizable until an
--       admin classifies them (generic codes; meaning not assumed).
-- Every classification stays editable in Expenses › Cost Components.

INSERT INTO "cost_components"
  ("id", "code", "name", "name_en", "sort_order", "is_active", "accounting_class", "capitalizable", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'PRODUCT_COST',         'تكلفة المنتج',                    'Product Cost',          10, true, 'OTHER',                 false, NOW(), NOW()),
  (gen_random_uuid(), 'CUSTOMS',              'الجمارك',                         'Customs',               20, true, 'INVENTORY_ACQUISITION', true,  NOW(), NOW()),
  (gen_random_uuid(), 'INBOUND_SHIPPING',     'شحن وارد',                        'Inbound Shipping',      30, true, 'INVENTORY_ACQUISITION', true,  NOW(), NOW()),
  (gen_random_uuid(), 'PRODUCT_PREPARATION',  'تجهيز المنتج للبيع قبل التخزين',   'Product Preparation',   40, true, 'INVENTORY_ACQUISITION', true,  NOW(), NOW()),
  (gen_random_uuid(), 'OUTBOUND_PREPARATION', 'تجهيز وتغليف الطلبات للشحن',       'Order Fulfillment',     50, true, 'FULFILLMENT',           false, NOW(), NOW()),
  (gen_random_uuid(), 'PRINTING',             'طباعة',                           'Printing',              60, true, 'OTHER',                 false, NOW(), NOW()),
  (gen_random_uuid(), 'PACKAGING',            'تغليف',                           'Packaging',             70, true, 'OTHER',                 false, NOW(), NOW()),
  (gen_random_uuid(), 'CUSTOM_BOX',           'علب مخصصة',                        'Custom Box',            80, true, 'OTHER',                 false, NOW(), NOW()),
  (gen_random_uuid(), 'OTHER',                'أخرى',                            'Other',                 90, true, 'OTHER',                 false, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
