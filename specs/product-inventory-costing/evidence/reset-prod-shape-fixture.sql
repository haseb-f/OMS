-- R13 reset rehearsal — Production-shaped rows added to the LOCAL forced clone only (oms_reset_r13b_forced).
-- Production holds 15 confirmed purchase returns and r13b asset / prepaid rows; the r7_final data has 3 returns and
-- no r13b links, so this fixture creates them to exercise the new foreign keys:
--   fixed_assets.purchase_return_id / disposal_partner_id, prepaid_expenses.purchase_return_id / refund_partner_id /
--   refund_receiving_account_id, fixed_asset_cost_additions (→ purchase_invoice_items RESTRICT, → fixed_assets CASCADE),
--   purchase_invoice_items.linked_fixed_asset_id.
BEGIN;

-- 1. A confirmed purchase return of invoice ddd33ccf… returning its FIXED_ASSET line and its PREPAID_EXPENSE line.
INSERT INTO purchase_returns (id, return_number, purchase_invoice_id, currency_id, status, subtotal, discount_total,
  tax_total, grand_total, posted_to_accounting, accounting_posted_at, confirmed_at, created_at, updated_at, partner_id, exchange_rate)
SELECT 'aaaa0000-0000-4000-8000-000000000001', 'PR-REHEARSAL-ASSET', pi.id, pi.currency_id, 'CONFIRMED', 1800, 0, 0, 1800,
       true, now(), now(), now(), now(), pi.partner_id, 1
FROM purchase_invoices pi WHERE pi.id = 'ddd33ccf-2441-4701-be87-6848a63e87d1';

INSERT INTO purchase_return_items (id, purchase_return_id, purchase_invoice_item_id, product_id, description, warehouse_id,
  unit_id, quantity, unit_price, discount_percent, discount_value, tax_amount, line_total, created_at, updated_at)
SELECT gen_random_uuid(), 'aaaa0000-0000-4000-8000-000000000001', i.id, i.product_id, 'rehearsal return', i.warehouse_id,
       i.unit_id, i.quantity, i.unit_price, 0, 0, 0, i.quantity * i.unit_price, now(), now()
FROM purchase_invoice_items i
WHERE i.id IN ('2d6a3eb2-76e6-400f-bb1c-e8ab9af9b775', 'dd2fe416-0f7b-4ccd-a575-caaab4beb7c3');

-- 2. The asset of that line derecognized by the return, proceeds settled with the supplier (r13b O-1).
UPDATE fixed_assets SET status = 'DISPOSED', purchase_return_id = 'aaaa0000-0000-4000-8000-000000000001',
       disposal_partner_id = (SELECT partner_id FROM purchase_invoices WHERE id = 'ddd33ccf-2441-4701-be87-6848a63e87d1'),
       disposed_at = now()
WHERE id = 'c210fa8c-c7bd-42c0-825a-416020cbe9c9';

-- 3. The prepayment of that line closed by the return with a refund (r13b O-3).
UPDATE prepaid_expenses SET status = 'CANCELLED', closure_type = 'PURCHASE_RETURN',
       purchase_return_id = 'aaaa0000-0000-4000-8000-000000000001', closed_on = current_date, refund_amount = 600,
       refund_partner_id = (SELECT partner_id FROM purchase_invoices WHERE id = 'ddd33ccf-2441-4701-be87-6848a63e87d1'),
       refund_receiving_account_id = (SELECT id FROM receiving_accounts WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1)
WHERE id = 'a7636476-62df-4c4c-a95a-8cc603d16a7b';

-- 4. A later invoice line adding a directly attributable cost to another asset (r13b O-2).
WITH line AS (
  SELECT i.id, i.purchase_invoice_id FROM purchase_invoice_items i
  WHERE i.treatment = 'STANDARD' AND i.purchase_invoice_id <> '80ca27ef-8ac4-46b2-8794-2c3f6bd531e7'
  ORDER BY i.created_at LIMIT 1
), upd AS (
  UPDATE purchase_invoice_items SET linked_fixed_asset_id = 'a9115c74-56dc-4707-91d1-d264c9d38086'
  WHERE id = (SELECT id FROM line) RETURNING id
)
INSERT INTO fixed_asset_cost_additions (id, fixed_asset_id, purchase_invoice_item_id, purchase_invoice_id, amount, added_on, respread_periods)
SELECT gen_random_uuid(), 'a9115c74-56dc-4707-91d1-d264c9d38086', line.id, line.purchase_invoice_id, 150, current_date, 12 FROM line;

-- 5. Eleven more confirmed returns (copies of PR 69ec8c71… with its lines) → 15 confirmed returns, as on Production.
INSERT INTO purchase_returns (id, return_number, purchase_invoice_id, currency_id, reference_number, status, subtotal,
  discount_total, tax_total, grand_total, posted_to_accounting, accounting_posted_at, confirmed_at, created_at, updated_at,
  partner_id, exchange_rate)
SELECT ('aaaa0000-0000-4000-8000-0000000001' || lpad(g::text, 2, '0'))::uuid, 'PR-REHEARSAL-' || g, r.purchase_invoice_id,
       r.currency_id, r.reference_number, 'CONFIRMED', r.subtotal, r.discount_total, r.tax_total, r.grand_total, true, now(),
       now(), now(), now(), r.partner_id, r.exchange_rate
FROM purchase_returns r, generate_series(1, 11) g WHERE r.id = '69ec8c71-f3d0-4dff-b914-4d582975c719';

INSERT INTO purchase_return_items (id, purchase_return_id, purchase_invoice_item_id, product_id, description, warehouse_id,
  unit_id, quantity, unit_price, discount_percent, discount_value, tax_id, tax_amount, line_total, created_at, updated_at)
SELECT gen_random_uuid(), ('aaaa0000-0000-4000-8000-0000000001' || lpad(g::text, 2, '0'))::uuid, i.purchase_invoice_item_id,
       i.product_id, i.description, i.warehouse_id, i.unit_id, i.quantity, i.unit_price, i.discount_percent, i.discount_value,
       i.tax_id, i.tax_amount, i.line_total, now(), now()
FROM purchase_return_items i, generate_series(1, 11) g WHERE i.purchase_return_id = '69ec8c71-f3d0-4dff-b914-4d582975c719';

COMMIT;

SELECT 'confirmed purchase returns' AS what, count(*) FROM purchase_returns WHERE status = 'CONFIRMED'
UNION ALL SELECT 'assets linked to a return', count(*) FROM fixed_assets WHERE purchase_return_id IS NOT NULL
UNION ALL SELECT 'prepaids linked to a return', count(*) FROM prepaid_expenses WHERE purchase_return_id IS NOT NULL
UNION ALL SELECT 'asset cost additions', count(*) FROM fixed_asset_cost_additions
UNION ALL SELECT 'invoice lines linked to an asset', count(*) FROM purchase_invoice_items WHERE linked_fixed_asset_id IS NOT NULL;
