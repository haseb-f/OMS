-- Job Titles: from a closed, read-only, seed-managed label list (TASK-060
-- Part 2) to full dynamic Master Data — Create/Edit/Activate/Archive/
-- Restore, same shape as Departments/Customer Classifications/No Purchase
-- Reasons. The FK from users/employee_profiles already existed; this only
-- adds the missing Master Data columns.

ALTER TABLE "job_titles"
  ADD COLUMN IF NOT EXISTS "code" TEXT,
  ADD COLUMN IF NOT EXISTS "name_en" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "department_id" UUID,
  ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "created_by" UUID,
  ADD COLUMN IF NOT EXISTS "updated_by" UUID,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

-- Backfill a stable code + English name for the 8 seeded titles (TASK-060
-- Part 2) so existing rows are never left with a null code once it becomes
-- required. A custom title created going forward gets its code from the
-- Numbering Engine (JOB_TITLE series, seeded below) — never typed by hand.
UPDATE "job_titles" SET "code" = 'SYSTEM_ADMIN', "name_en" = 'System Administrator' WHERE "name" = 'مدير النظام' AND "code" IS NULL;
UPDATE "job_titles" SET "code" = 'GENERAL_MANAGER', "name_en" = 'General Manager' WHERE "name" = 'المدير العام' AND "code" IS NULL;
UPDATE "job_titles" SET "code" = 'FINANCE_MANAGER', "name_en" = 'Finance Manager' WHERE "name" = 'المدير المالي' AND "code" IS NULL;
UPDATE "job_titles" SET "code" = 'ACCOUNTANT', "name_en" = 'Accountant' WHERE "name" = 'المحاسب' AND "code" IS NULL;
UPDATE "job_titles" SET "code" = 'SALES_MANAGER', "name_en" = 'Sales Manager' WHERE "name" = 'مدير المبيعات' AND "code" IS NULL;
UPDATE "job_titles" SET "code" = 'OPERATIONS_MANAGER', "name_en" = 'Operations Manager' WHERE "name" = 'مدير التشغيل' AND "code" IS NULL;
UPDATE "job_titles" SET "code" = 'CUSTOMER_SERVICE', "name_en" = 'Customer Service Representative' WHERE "name" = 'موظف خدمة العملاء' AND "code" IS NULL;
UPDATE "job_titles" SET "code" = 'SHIPPING_STAFF', "name_en" = 'Shipping Staff' WHERE "name" = 'موظف الشحن' AND "code" IS NULL;
-- Any other pre-existing row (a hand-inserted title this migration didn't
-- anticipate) still gets a unique, if generic, code rather than blocking
-- the NOT NULL constraint below.
UPDATE "job_titles" SET "code" = 'JT_LEGACY_' || substr("id"::text, 1, 8) WHERE "code" IS NULL;

ALTER TABLE "job_titles" ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "job_titles_code_key" ON "job_titles"("code");
CREATE INDEX IF NOT EXISTS "job_titles_deleted_at_is_active_sort_order_idx" ON "job_titles"("deleted_at", "is_active", "sort_order");
CREATE INDEX IF NOT EXISTS "job_titles_department_id_idx" ON "job_titles"("department_id");

ALTER TABLE "job_titles"
  ADD CONSTRAINT "job_titles_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- JOB_TITLE numbering series — same idempotent insert pattern as the
-- CUSTOMER_CLASSIFICATION series (see 20260904120000_sales_flow_hardening).
INSERT INTO "number_series" (
    "id", "document_type", "label", "doc_code", "template",
    "next_number", "padding", "separator",
    "year_reset", "month_reset", "day_reset", "active",
    "created_at", "updated_at"
)
SELECT gen_random_uuid(), 'JOB_TITLE', 'Job Title', 'JT', '{DOC}-{SEQ}',
    1, 6, '-', false, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "number_series" WHERE "document_type" = 'JOB_TITLE');
