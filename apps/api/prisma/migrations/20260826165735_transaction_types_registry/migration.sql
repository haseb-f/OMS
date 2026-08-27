-- CreateEnum
CREATE TYPE "TransactionDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "TransactionNature" AS ENUM ('STANDARD', 'TRANSFER');

-- CreateEnum
CREATE TYPE "TransactionAccountingTreatment" AS ENUM ('OPERATING_REVENUE', 'OPERATING_EXPENSE', 'EQUITY_MOVEMENT', 'LIABILITY_MOVEMENT', 'TRANSFER', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "TransactionMatchingTarget" AS ENUM ('STORE_ORDER', 'SALES_INVOICE', 'PURCHASE_INVOICE', 'CUSTOMER', 'VENDOR', 'EMPLOYEE', 'FINANCIAL_ACCOUNT', 'EXPENSE_ACCOUNT', 'LIABILITY', 'EQUITY_OR_PARTNER', 'INVESTMENT', 'ACCOUNT');

-- CreateTable
CREATE TABLE "transaction_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT,
    "direction" "TransactionDirection" NOT NULL,
    "nature" "TransactionNature" NOT NULL DEFAULT 'STANDARD',
    "matching_target" "TransactionMatchingTarget",
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "default_accounting_treatment" "TransactionAccountingTreatment" NOT NULL DEFAULT 'NEUTRAL',
    "default_account_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "transaction_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transaction_types_code_key" ON "transaction_types"("code");

-- CreateIndex
CREATE INDEX "transaction_types_direction_is_active_idx" ON "transaction_types"("direction", "is_active");

-- AddForeignKey
ALTER TABLE "transaction_types" ADD CONSTRAINT "transaction_types_default_account_id_fkey" FOREIGN KEY ("default_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed System Transaction Types (spec sections 8/9) — same "insert once at
-- migration time" pattern as shipping_status_master_and_payment_type, so
-- these exist immediately after `prisma migrate deploy` with no separate
-- manual seed step required in production. Kept in sync by hand with
-- `src/transaction-types/transaction-type.catalog.ts` (SQL can't import
-- TS); `prisma/seed.ts` upserts from that same catalog by `code` for
-- idempotent local/dev re-seeding.
INSERT INTO "transaction_types"
    ("id", "code", "name_ar", "name_en", "direction", "nature", "matching_target", "is_system", "is_active", "default_accounting_treatment", "sort_order", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), 'STORE_ORDER_COLLECTION', 'تحصيل طلب متجر', 'Store Order Collection', 'IN', 'STANDARD', 'STORE_ORDER', true, true, 'OPERATING_REVENUE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'CUSTOMER_INVOICE_COLLECTION', 'تحصيل فاتورة عميل', 'Customer Invoice Collection', 'IN', 'STANDARD', 'SALES_INVOICE', true, true, 'OPERATING_REVENUE', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'CUSTOMER_ADVANCE', 'دفعة مقدمة من عميل', 'Customer Advance', 'IN', 'STANDARD', 'CUSTOMER', true, true, 'LIABILITY_MOVEMENT', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'DIRECT_REVENUE', 'إيراد مباشر', 'Direct Revenue', 'IN', 'STANDARD', 'ACCOUNT', true, true, 'OPERATING_REVENUE', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'VENDOR_REFUND', 'استرداد من مورد', 'Vendor Refund', 'IN', 'STANDARD', 'VENDOR', true, true, 'NEUTRAL', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'FINANCING_RECEIVED', 'تمويل / قرض مستلم', 'Financing Received', 'IN', 'STANDARD', 'LIABILITY', true, true, 'LIABILITY_MOVEMENT', 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'OWNER_CONTRIBUTION', 'مساهمة مالك / شريك', 'Owner Contribution', 'IN', 'STANDARD', 'EQUITY_OR_PARTNER', true, true, 'EQUITY_MOVEMENT', 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'INVESTMENT_RECEIVED', 'استثمار وارد', 'Investment Received', 'IN', 'STANDARD', 'INVESTMENT', true, true, 'EQUITY_MOVEMENT', 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'INTERNAL_TRANSFER_IN', 'تحويل وارد بين الحسابات', 'Internal Transfer In', 'IN', 'TRANSFER', 'FINANCIAL_ACCOUNT', true, true, 'TRANSFER', 8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'VENDOR_BILL_PAYMENT', 'سداد فاتورة مورد', 'Vendor Bill Payment', 'OUT', 'STANDARD', 'PURCHASE_INVOICE', true, true, 'LIABILITY_MOVEMENT', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'VENDOR_ADVANCE', 'دفعة مقدمة لمورد', 'Vendor Advance', 'OUT', 'STANDARD', 'VENDOR', true, true, 'NEUTRAL', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'OPERATING_EXPENSE', 'مصروف تشغيلي', 'Operating Expense', 'OUT', 'STANDARD', 'EXPENSE_ACCOUNT', true, true, 'OPERATING_EXPENSE', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'PAYROLL_PAYMENT', 'رواتب وأجور', 'Payroll Payment', 'OUT', 'STANDARD', 'EXPENSE_ACCOUNT', true, true, 'OPERATING_EXPENSE', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'EMPLOYEE_ADVANCE', 'سلفة / عهدة موظف', 'Employee Advance', 'OUT', 'STANDARD', 'EMPLOYEE', true, true, 'NEUTRAL', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'CUSTOMER_REFUND', 'استرداد مبلغ لعميل', 'Customer Refund', 'OUT', 'STANDARD', 'CUSTOMER', true, true, 'NEUTRAL', 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'FINANCING_REPAYMENT', 'سداد قرض / تمويل', 'Financing Repayment', 'OUT', 'STANDARD', 'LIABILITY', true, true, 'LIABILITY_MOVEMENT', 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'BANK_FEES', 'رسوم بنكية', 'Bank Fees', 'OUT', 'STANDARD', 'EXPENSE_ACCOUNT', true, true, 'OPERATING_EXPENSE', 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'PROFIT_DISTRIBUTION', 'توزيع أرباح', 'Profit Distribution', 'OUT', 'STANDARD', 'EQUITY_OR_PARTNER', true, true, 'EQUITY_MOVEMENT', 8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'INTERNAL_TRANSFER_OUT', 'تحويل صادر بين الحسابات', 'Internal Transfer Out', 'OUT', 'TRANSFER', 'FINANCIAL_ACCOUNT', true, true, 'TRANSFER', 9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
