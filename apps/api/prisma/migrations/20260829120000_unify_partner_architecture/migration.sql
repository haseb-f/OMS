-- Unified Partner Architecture — physical merge of Customer/Supplier into a
-- single canonical Partner identity (see .claude/plans "Unified Partner
-- Architecture — Physical Merge"). Foundation-stage decision: all current
-- rows are disposable test/dev data, so this migration backfills what is
-- mechanically preserved (identity + role config + subledger attribution on
-- existing Journal Entry lines) rather than building a compatibility layer.
--
-- Structure: (1) additive schema changes, (2) data backfill using the old
-- columns/tables while they still exist, (3) enforce NOT NULL / add FKs now
-- that data is populated, (4) drop the old columns/tables/enums.

-- =============================================================================
-- 1. ADDITIVE SCHEMA CHANGES
-- =============================================================================

-- CreateEnum
CREATE TYPE "PartnerEntityType" AS ENUM ('PERSON', 'ORGANIZATION');
CREATE TYPE "PartnerStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "PartnerRoleType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'OWNER', 'OTHER');
CREATE TYPE "PartnerControlAccountType" AS ENUM ('RECEIVABLE', 'PAYABLE');
CREATE TYPE "PartnerSource" AS ENUM ('MANUAL', 'WEBSITE', 'SALLA', 'API', 'IMPORT', 'GOOGLE_SHEETS', 'LEAD_CONVERSION', 'OTHER');

-- CreateTable
CREATE TABLE "partners" (
    "id" UUID NOT NULL,
    "partner_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "commercial_name" TEXT,
    "entity_type" "PartnerEntityType" NOT NULL DEFAULT 'ORGANIZATION',
    "phone" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "website" TEXT,
    "tax_number" TEXT,
    "commercial_registration" TEXT,
    "currency_id" UUID,
    "country_id" UUID,
    "city" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "status" "PartnerStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "PartnerSource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "partner_role_assignments" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "role" "PartnerRoleType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "partner_role_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_profiles" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "customer_group_id" UUID,
    "payment_term_id" UUID,
    "credit_limit" DECIMAL(12,2),
    "default_receivable_account_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_profiles" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "supplier_group_id" UUID,
    "payment_term" TEXT,
    "credit_limit" DECIMAL(12,2),
    "is_preferred" BOOLEAN NOT NULL DEFAULT false,
    "default_payable_account_id" UUID,
    "default_expense_account_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employee_profiles" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "user_id" UUID,
    "job_title_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partners_partner_number_key" ON "partners"("partner_number");
CREATE INDEX "partners_phone_idx" ON "partners"("phone");
CREATE INDEX "partners_email_idx" ON "partners"("email");
CREATE INDEX "partners_tax_number_idx" ON "partners"("tax_number");
CREATE INDEX "partners_deleted_at_name_idx" ON "partners"("deleted_at", "name");
CREATE UNIQUE INDEX "partner_role_assignments_partner_id_role_key" ON "partner_role_assignments"("partner_id", "role");
CREATE UNIQUE INDEX "customer_profiles_partner_id_key" ON "customer_profiles"("partner_id");
CREATE UNIQUE INDEX "supplier_profiles_partner_id_key" ON "supplier_profiles"("partner_id");
CREATE UNIQUE INDEX "employee_profiles_partner_id_key" ON "employee_profiles"("partner_id");
CREATE UNIQUE INDEX "employee_profiles_user_id_key" ON "employee_profiles"("user_id");

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "partners" ADD CONSTRAINT "partners_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "partner_role_assignments" ADD CONSTRAINT "partner_role_assignments_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_customer_group_id_fkey" FOREIGN KEY ("customer_group_id") REFERENCES "customer_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_default_receivable_account_id_fkey" FOREIGN KEY ("default_receivable_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_profiles_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_profiles_supplier_group_id_fkey" FOREIGN KEY ("supplier_group_id") REFERENCES "supplier_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_profiles_default_payable_account_id_fkey" FOREIGN KEY ("default_payable_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_profiles_default_expense_account_id_fkey" FOREIGN KEY ("default_expense_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_titles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ChartOfAccount.partnerControlType
ALTER TABLE "chart_of_accounts" ADD COLUMN "partner_control_type" "PartnerControlAccountType";

-- New nullable partner_id columns (backfilled below, tightened to NOT NULL
-- in section 3 for the tables where it is required).
ALTER TABLE "leads" ADD COLUMN "partner_id" UUID;
ALTER TABLE "store_orders" ADD COLUMN "partner_id" UUID;
ALTER TABLE "sales_quotations" ADD COLUMN "partner_id" UUID;
ALTER TABLE "sales_order_documents" ADD COLUMN "partner_id" UUID;
ALTER TABLE "sales_invoices" ADD COLUMN "partner_id" UUID;
ALTER TABLE "sales_returns" ADD COLUMN "partner_id" UUID;
ALTER TABLE "purchase_orders" ADD COLUMN "partner_id" UUID;
ALTER TABLE "purchase_quotations" ADD COLUMN "partner_id" UUID;
ALTER TABLE "purchase_invoices" ADD COLUMN "partner_id" UUID;
ALTER TABLE "purchase_returns" ADD COLUMN "partner_id" UUID;
ALTER TABLE "products" ADD COLUMN "preferred_partner_id" UUID;
ALTER TABLE "financial_transactions" ADD COLUMN "partner_id" UUID;
ALTER TABLE "bank_transactions" ADD COLUMN "partner_id" UUID;
ALTER TABLE "journal_entry_lines" ADD COLUMN "partner_id" UUID;

-- =============================================================================
-- 2. DATA BACKFILL (old tables/columns still present at this point)
-- =============================================================================

-- 2a. Customer -> Partner + CustomerProfile + CUSTOMER role. Ids are reused
-- 1:1 so every downstream FK backfill below is a trivial same-value copy.
INSERT INTO "partners" (
  "id", "partner_number", "name", "legal_name", "commercial_name", "entity_type",
  "phone", "mobile", "email", "website", "tax_number", "commercial_registration",
  "currency_id", "country_id", "city", "address", "notes",
  "status", "source", "created_at", "updated_at", "created_by", "updated_by", "deleted_at"
)
SELECT
  c."id", c."customer_number", c."name", NULL, c."commercial_name", 'ORGANIZATION',
  c."phone", c."mobile", c."email", c."website", c."tax_number", c."commercial_registration",
  c."currency_id", c."country_id", c."city", c."address", c."notes",
  c."status"::text::"PartnerStatus", c."source"::text::"PartnerSource",
  c."created_at", c."updated_at", c."created_by", c."updated_by", c."deleted_at"
FROM "customers" c;

INSERT INTO "customer_profiles" (
  "id", "partner_id", "customer_group_id", "payment_term_id", "credit_limit",
  "default_receivable_account_id", "created_at", "updated_at"
)
SELECT gen_random_uuid(), c."id", c."customer_group_id", c."payment_term_id", c."credit_limit",
  c."default_receivable_account_id", c."created_at", c."updated_at"
FROM "customers" c;

INSERT INTO "partner_role_assignments" ("id", "partner_id", "role", "created_at", "created_by")
SELECT gen_random_uuid(), c."id", 'CUSTOMER', c."created_at", c."created_by"
FROM "customers" c;

-- 2b. Supplier -> Partner + SupplierProfile + SUPPLIER role. The old
-- user-editable `code` column is intentionally dropped (spec section 42:
-- Partner uses only the auto-generated partner_number).
INSERT INTO "partners" (
  "id", "partner_number", "name", "legal_name", "commercial_name", "entity_type",
  "phone", "mobile", "email", "website", "tax_number", "commercial_registration",
  "currency_id", "country_id", "city", "address", "notes",
  "status", "source", "created_at", "updated_at", "created_by", "updated_by", "deleted_at"
)
SELECT
  s."id", s."supplier_number", s."name", NULL, s."commercial_name", 'ORGANIZATION',
  s."phone", s."mobile", s."email", s."website", s."tax_number", s."commercial_registration",
  s."currency_id", s."country_id", s."city", s."address", s."notes",
  s."status"::text::"PartnerStatus", 'MANUAL',
  s."created_at", s."updated_at", s."created_by", s."updated_by", s."deleted_at"
FROM "suppliers" s;

INSERT INTO "supplier_profiles" (
  "id", "partner_id", "supplier_group_id", "payment_term", "credit_limit", "is_preferred",
  "default_payable_account_id", "default_expense_account_id", "created_at", "updated_at"
)
SELECT gen_random_uuid(), s."id", s."supplier_group_id", s."payment_term", s."credit_limit", s."is_preferred",
  s."default_payable_account_id", s."default_expense_account_id", s."created_at", s."updated_at"
FROM "suppliers" s;

INSERT INTO "partner_role_assignments" ("id", "partner_id", "role", "created_at", "created_by")
SELECT gen_random_uuid(), s."id", 'SUPPLIER', s."created_at", s."created_by"
FROM "suppliers" s;

-- 2c. SupplierActivity -> the shared MasterDataActivityLog pattern Customer
-- already used (dropping the duplicated dedicated-table pattern).
INSERT INTO "master_data_activity_logs" ("id", "entity_type", "entity_id", "type", "description", "metadata", "created_at", "created_by")
SELECT sa."id", 'PARTNER', sa."supplier_id", sa."type", sa."description", sa."metadata", sa."created_at", sa."created_by"
FROM "supplier_activities" sa;

-- 2d. FK backfills — same id reused, so this is a pure copy.
UPDATE "leads" SET "partner_id" = "customer_id" WHERE "customer_id" IS NOT NULL;
UPDATE "store_orders" SET "partner_id" = "customer_id";
UPDATE "sales_quotations" SET "partner_id" = "customer_id";
UPDATE "sales_order_documents" SET "partner_id" = "customer_id";
UPDATE "sales_invoices" SET "partner_id" = "customer_id";
UPDATE "sales_returns" SET "partner_id" = "customer_id";
UPDATE "purchase_orders" SET "partner_id" = "supplier_id";
UPDATE "purchase_quotations" SET "partner_id" = "supplier_id";
UPDATE "purchase_invoices" SET "partner_id" = "supplier_id";
UPDATE "purchase_returns" SET "partner_id" = "supplier_id";
UPDATE "products" SET "preferred_partner_id" = "preferred_supplier_id" WHERE "preferred_supplier_id" IS NOT NULL;
UPDATE "financial_transactions" SET "partner_id" = COALESCE("customer_id", "supplier_id");
UPDATE "bank_transactions" SET "partner_id" = "partner_supplier_id" WHERE "partner_supplier_id" IS NOT NULL;

-- 2e. JournalEntryLine.partner_id — best-effort backfill of pre-existing
-- entries, matching each line whose account is the (global) AR/AP control
-- account against its source document's partner. Dev-data audit confirmed
-- no per-customer/group override accounts are populated, so the single
-- PostingSettings AR/AP account correctly identifies every existing AR/AP
-- line — this simplification is only valid for this one-time historical
-- backfill, never for the ongoing application logic (which always resolves
-- through AccountMappingService's full override chain).
UPDATE "journal_entry_lines" jel
SET "partner_id" = si."partner_id"
FROM "journal_entries" je
JOIN "sales_invoices" si ON si."id" = je."source_id"
JOIN "posting_settings" ps ON true
WHERE jel."journal_entry_id" = je."id"
  AND je."source_type" = 'SALES_INVOICE'
  AND jel."account_id" = ps."ar_account_id";

UPDATE "journal_entry_lines" jel
SET "partner_id" = sr."partner_id"
FROM "journal_entries" je
JOIN "sales_returns" sr ON sr."id" = je."source_id"
JOIN "posting_settings" ps ON true
WHERE jel."journal_entry_id" = je."id"
  AND je."source_type" = 'SALES_RETURN'
  AND jel."account_id" = ps."ar_account_id";

UPDATE "journal_entry_lines" jel
SET "partner_id" = pi."partner_id"
FROM "journal_entries" je
JOIN "purchase_invoices" pi ON pi."id" = je."source_id"
JOIN "posting_settings" ps ON true
WHERE jel."journal_entry_id" = je."id"
  AND je."source_type" = 'PURCHASE_INVOICE'
  AND jel."account_id" = ps."ap_account_id";

UPDATE "journal_entry_lines" jel
SET "partner_id" = pr."partner_id"
FROM "journal_entries" je
JOIN "purchase_returns" pr ON pr."id" = je."source_id"
JOIN "posting_settings" ps ON true
WHERE jel."journal_entry_id" = je."id"
  AND je."source_type" = 'PURCHASE_RETURN'
  AND jel."account_id" = ps."ap_account_id";

UPDATE "journal_entry_lines" jel
SET "partner_id" = ft."partner_id"
FROM "journal_entries" je
JOIN "financial_transactions" ft ON ft."id" = je."source_id"
JOIN "posting_settings" ps ON true
WHERE jel."journal_entry_id" = je."id"
  AND je."source_type" = 'CUSTOMER_RECEIPT'
  AND jel."account_id" = ps."ar_account_id";

UPDATE "journal_entry_lines" jel
SET "partner_id" = ft."partner_id"
FROM "journal_entries" je
JOIN "financial_transactions" ft ON ft."id" = je."source_id"
JOIN "posting_settings" ps ON true
WHERE jel."journal_entry_id" = je."id"
  AND je."source_type" = 'SUPPLIER_PAYMENT'
  AND jel."account_id" = ps."ap_account_id";

-- Fallback for manual Journal Entries that carried the old decorative
-- header-level partner (only 1 row in dev data) — same AR/AP-account match,
-- read before the header columns are dropped in section 4.
UPDATE "journal_entry_lines" jel
SET "partner_id" = je."partner_customer_id"
FROM "journal_entries" je, "posting_settings" ps
WHERE jel."journal_entry_id" = je."id"
  AND je."partner_customer_id" IS NOT NULL
  AND jel."account_id" = ps."ar_account_id"
  AND jel."partner_id" IS NULL;

UPDATE "journal_entry_lines" jel
SET "partner_id" = je."partner_supplier_id"
FROM "journal_entries" je, "posting_settings" ps
WHERE jel."journal_entry_id" = je."id"
  AND je."partner_supplier_id" IS NOT NULL
  AND jel."account_id" = ps."ap_account_id"
  AND jel."partner_id" IS NULL;

-- 2f. ChartOfAccount.partner_control_type — flag whichever accounts are
-- currently wired as the global AR/AP control accounts (dev data has no
-- per-customer/group overrides populated to also flag).
UPDATE "chart_of_accounts" SET "partner_control_type" = 'RECEIVABLE'
WHERE "id" IN (SELECT "ar_account_id" FROM "posting_settings" WHERE "ar_account_id" IS NOT NULL);
UPDATE "chart_of_accounts" SET "partner_control_type" = 'PAYABLE'
WHERE "id" IN (SELECT "ap_account_id" FROM "posting_settings" WHERE "ap_account_id" IS NOT NULL);

-- =============================================================================
-- 3. ENFORCE NOT NULL + ADD NEW FOREIGN KEYS
-- =============================================================================

ALTER TABLE "leads" ADD CONSTRAINT "leads_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_preferred_partner_id_fkey" FOREIGN KEY ("preferred_partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "store_orders" ALTER COLUMN "partner_id" SET NOT NULL;
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_quotations" ALTER COLUMN "partner_id" SET NOT NULL;
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_order_documents" ALTER COLUMN "partner_id" SET NOT NULL;
ALTER TABLE "sales_order_documents" ADD CONSTRAINT "sales_order_documents_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_invoices" ALTER COLUMN "partner_id" SET NOT NULL;
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_returns" ALTER COLUMN "partner_id" SET NOT NULL;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_orders" ALTER COLUMN "partner_id" SET NOT NULL;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_quotations" ALTER COLUMN "partner_id" SET NOT NULL;
ALTER TABLE "purchase_quotations" ADD CONSTRAINT "purchase_quotations_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_invoices" ALTER COLUMN "partner_id" SET NOT NULL;
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_returns" ALTER COLUMN "partner_id" SET NOT NULL;
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- 4. DROP OLD COLUMNS / CONSTRAINTS / TABLES / ENUMS
-- =============================================================================

ALTER TABLE "leads" DROP CONSTRAINT "leads_customer_id_fkey";
ALTER TABLE "leads" DROP COLUMN "customer_id";

ALTER TABLE "store_orders" DROP CONSTRAINT "store_orders_customer_id_fkey";
DROP INDEX "store_orders_customer_id_idx";
ALTER TABLE "store_orders" DROP COLUMN "customer_id";
CREATE INDEX "store_orders_partner_id_idx" ON "store_orders"("partner_id");

ALTER TABLE "sales_quotations" DROP CONSTRAINT "sales_quotations_customer_id_fkey";
ALTER TABLE "sales_quotations" DROP COLUMN "customer_id";

ALTER TABLE "sales_order_documents" DROP CONSTRAINT "sales_order_documents_customer_id_fkey";
ALTER TABLE "sales_order_documents" DROP COLUMN "customer_id";

ALTER TABLE "sales_invoices" DROP CONSTRAINT "sales_invoices_customer_id_fkey";
ALTER TABLE "sales_invoices" DROP COLUMN "customer_id";

ALTER TABLE "sales_returns" DROP CONSTRAINT "sales_returns_customer_id_fkey";
ALTER TABLE "sales_returns" DROP COLUMN "customer_id";

ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_supplier_id_fkey";
ALTER TABLE "purchase_orders" DROP COLUMN "supplier_id";

ALTER TABLE "purchase_quotations" DROP CONSTRAINT "purchase_quotations_supplier_id_fkey";
ALTER TABLE "purchase_quotations" DROP COLUMN "supplier_id";

ALTER TABLE "purchase_invoices" DROP CONSTRAINT "purchase_invoices_supplier_id_fkey";
ALTER TABLE "purchase_invoices" DROP COLUMN "supplier_id";

ALTER TABLE "purchase_returns" DROP CONSTRAINT "purchase_returns_supplier_id_fkey";
ALTER TABLE "purchase_returns" DROP COLUMN "supplier_id";

ALTER TABLE "products" DROP CONSTRAINT "products_preferred_supplier_id_fkey";
ALTER TABLE "products" DROP COLUMN "preferred_supplier_id";

ALTER TABLE "financial_transactions" DROP CONSTRAINT "financial_transactions_customer_id_fkey";
ALTER TABLE "financial_transactions" DROP CONSTRAINT "financial_transactions_supplier_id_fkey";
ALTER TABLE "financial_transactions" DROP COLUMN "customer_id";
ALTER TABLE "financial_transactions" DROP COLUMN "supplier_id";

ALTER TABLE "bank_transactions" DROP CONSTRAINT "bank_transactions_partner_supplier_id_fkey";
ALTER TABLE "bank_transactions" DROP COLUMN "partner_supplier_id";

ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_partner_customer_id_fkey";
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_partner_supplier_id_fkey";
ALTER TABLE "journal_entries" DROP COLUMN "partner_customer_id";
ALTER TABLE "journal_entries" DROP COLUMN "partner_supplier_id";

ALTER TABLE "supplier_activities" DROP CONSTRAINT "supplier_activities_supplier_id_fkey";
DROP TABLE "supplier_activities";
DROP TABLE "customers";
DROP TABLE "suppliers";

DROP TYPE "CustomerSource";
DROP TYPE "CustomerStatus";
DROP TYPE "SupplierStatus";

CREATE INDEX "journal_entry_lines_partner_id_idx" ON "journal_entry_lines"("partner_id");
CREATE INDEX "journal_entry_lines_account_id_partner_id_idx" ON "journal_entry_lines"("account_id", "partner_id");

-- =============================================================================
-- 5. NUMBER SERIES + STALE PERMISSIONS CLEANUP
-- =============================================================================

DELETE FROM "number_series" WHERE "document_type" IN ('CUSTOMER', 'SUPPLIER');
INSERT INTO "number_series" ("id", "document_type", "label", "doc_code", "template", "next_number", "padding", "separator", "year_reset", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'PARTNER', 'Partner', 'PT', '{DOC}-{YEAR}-{SEQ}', 1, 6, '-', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

DELETE FROM "permissions" WHERE "name" LIKE 'sales.customers.%' OR "name" LIKE 'purchasing.suppliers.%';
