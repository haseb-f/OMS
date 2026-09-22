-- Number series that existed only in prisma/seed.ts never reached
-- Production (e.g. INVESTMENT_OPPORTUNITY), so creating those documents
-- failed with "No active number series configured". Additive only: rows
-- that already exist (and their counters) are never touched.
INSERT INTO "number_series" (
  "id", "document_type", "label", "doc_code", "template",
  "next_number", "padding", "separator",
  "year_reset", "month_reset", "day_reset", "active",
  "created_at", "updated_at"
)
SELECT gen_random_uuid(), v.document_type, v.label, v.doc_code, v.template,
  1, v.padding, '-', v.year_reset, v.month_reset, v.day_reset, true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('PARTNER', 'Partner', 'PT', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('LEAD', 'Lead', 'LD', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('SALES_ORDER', 'Sales Order', 'SO', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('PAYMENT', 'Payment', 'PAY', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('PURCHASE_ORDER', 'Purchase Order', 'PO', '{BRANCH}-{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('INVENTORY_MOVEMENT', 'Inventory Movement', 'MV', '{DOC}/{MONTH}/{YEAR}/{SEQ}', 6, false, true, false),
  ('OPENING_INVENTORY', 'Opening Inventory', 'OPN', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('INVENTORY_ADJUSTMENT', 'Inventory Adjustment', 'ADJ', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('SALES_INVOICE', 'Sales Invoice', 'INV', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('SALES_ORDER_DOC', 'Sales Order', 'SO', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('SALES_RETURN', 'Sales Return', 'SR', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('PURCHASE_INVOICE', 'Purchase Invoice', 'PI', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('CUSTOMER_RECEIPT', 'Customer Receipt', 'CR', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('SUPPLIER_PAYMENT', 'Supplier Payment', 'SP', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('EXPENSE_PAYMENT', 'Expense Payment', 'EP', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('PURCHASE_QUOTATION', 'Purchase Quotation', 'PQ', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('PURCHASE_RETURN', 'Purchase Return', 'PR', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('QUOTATION', 'Quotation', 'QT', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('EXPENSE', 'Expense', 'EXP', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('JOURNAL_ENTRY', 'Journal Entry', 'JV', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('RECEIPT', 'Receipt', 'RCP', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('OPPORTUNITY', 'Opportunity', 'OPP', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('INVESTMENT_OPPORTUNITY', 'Investment Opportunity', 'IOP', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('PROFIT_DISTRIBUTION', 'Profit Distribution', 'PDIST', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('CAPITAL_RETURN', 'Capital Return', 'CRET', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('PRODUCT', 'Product', 'PRD', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('WAREHOUSE_TRANSFER', 'Warehouse Transfer', 'TRF', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('WAREHOUSE', 'Warehouse', 'WH', '{DOC}-{SEQ}', 6, true, false, false),
  ('WAREHOUSE_LOCATION', 'Warehouse Location', 'LOC', '{DOC}-{SEQ}', 6, true, false, false),
  ('PAYMENT_TERM', 'Payment Term', 'PT', '{DOC}-{SEQ}', 6, true, false, false),
  ('DEPARTMENT', 'Department', 'DEPT', '{DOC}-{SEQ}', 6, false, false, false),
  ('CUSTOMER_CLASSIFICATION', 'Customer Classification', 'CC', '{DOC}-{SEQ}', 6, false, false, false),
  ('NO_PURCHASE_REASON', 'No Purchase Reason', 'NPR', '{DOC}-{SEQ}', 6, false, false, false),
  ('LEAD_FOLLOW_UP_TYPE', 'Lead Follow-up Type', 'LFT', '{DOC}-{SEQ}', 6, false, false, false),
  ('COST_CATEGORY', 'Cost Category', 'CTG', '{DOC}-{SEQ}', 6, false, false, false),
  ('LANDED_COST', 'Landed Cost Document', 'LC', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('JOB_TITLE', 'Job Title', 'JT', '{DOC}-{SEQ}', 6, false, false, false),
  ('SALES_TEAM', 'Sales Team', 'ST', '{DOC}-{SEQ}', 6, false, false, false),
  ('INVENTORY_COUNT', 'Inventory Count', 'CNT', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('EMPLOYEE', 'Employee', 'EMP', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('ASSET', 'Asset', 'AST', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false),
  ('STORE_ORDER', 'Store Order', 'STO', '{DOC}-{YEAR}-{SEQ}', 6, true, false, false)
) AS v(document_type, label, doc_code, template, padding, year_reset, month_reset, day_reset)
ON CONFLICT ("document_type") DO NOTHING;
