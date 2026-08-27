import {
  TransactionAccountingTreatment,
  TransactionDirection,
  TransactionMatchingTarget,
  TransactionNature,
} from '@prisma/client';

export interface TransactionTypeCatalogEntry {
  code: string;
  nameAr: string;
  nameEn: string;
  direction: TransactionDirection;
  nature: TransactionNature;
  matchingTarget: TransactionMatchingTarget | null;
  defaultAccountingTreatment: TransactionAccountingTreatment;
  sortOrder: number;
}

/**
 * Canonical System Transaction Types — the ONE place this vocabulary is
 * defined. `prisma/seed.ts` upserts from this list by `code` (idempotent,
 * same dual seed-migration+seed.ts pattern as `INITIAL_SHIPPING_STATUSES`);
 * `TransactionTypesService` reads it to decide which codes are
 * system-protected; tests assert against it directly rather than
 * duplicating the list a third time.
 *
 * `matchingTarget` is normalized to the closed, generic
 * `TransactionMatchingTarget` set (never a compound/one-off string) per
 * the registry's own "do not over-engineer, normalize to existing
 * concepts" rule — e.g. a vendor refund's natural target is "a specific
 * vendor or one of their purchase invoices," normalized here to the single
 * closest bucket, `VENDOR`.
 *
 * `defaultAccountingTreatment` exists purely to make "not every IN is
 * Revenue, not every OUT is Expense" a structural fact: financing/owner/
 * investment inflows and financing-repayment/profit-distribution outflows
 * are deliberately never OPERATING_REVENUE/OPERATING_EXPENSE.
 */
export const SYSTEM_TRANSACTION_TYPES: readonly TransactionTypeCatalogEntry[] =
  [
    // -- Incoming (IN) -----------------------------------------------------
    {
      code: 'STORE_ORDER_COLLECTION',
      nameAr: 'تحصيل طلب متجر',
      nameEn: 'Store Order Collection',
      direction: TransactionDirection.IN,
      nature: TransactionNature.STANDARD,
      matchingTarget: TransactionMatchingTarget.STORE_ORDER,
      defaultAccountingTreatment:
        TransactionAccountingTreatment.OPERATING_REVENUE,
      sortOrder: 0,
    },
    {
      code: 'CUSTOMER_INVOICE_COLLECTION',
      nameAr: 'تحصيل فاتورة عميل',
      nameEn: 'Customer Invoice Collection',
      direction: TransactionDirection.IN,
      nature: TransactionNature.STANDARD,
      matchingTarget: TransactionMatchingTarget.SALES_INVOICE,
      defaultAccountingTreatment:
        TransactionAccountingTreatment.OPERATING_REVENUE,
      sortOrder: 1,
    },
    {
      code: 'CUSTOMER_ADVANCE',
      nameAr: 'دفعة مقدمة من عميل',
      nameEn: 'Customer Advance',
      direction: TransactionDirection.IN,
      nature: TransactionNature.STANDARD,
      matchingTarget: TransactionMatchingTarget.CUSTOMER,
      defaultAccountingTreatment:
        TransactionAccountingTreatment.LIABILITY_MOVEMENT,
      sortOrder: 2,
    },
    {
      code: 'DIRECT_REVENUE',
      nameAr: 'إيراد مباشر',
      nameEn: 'Direct Revenue',
      direction: TransactionDirection.IN,
      nature: TransactionNature.STANDARD,
      matchingTarget: TransactionMatchingTarget.ACCOUNT,
      defaultAccountingTreatment:
        TransactionAccountingTreatment.OPERATING_REVENUE,
      sortOrder: 3,
    },
    {
      code: 'VENDOR_REFUND',
      nameAr: 'استرداد من مورد',
      nameEn: 'Vendor Refund',
      direction: TransactionDirection.IN,
      nature: TransactionNature.STANDARD,
      matchingTarget: TransactionMatchingTarget.VENDOR,
      defaultAccountingTreatment: TransactionAccountingTreatment.NEUTRAL,
      sortOrder: 4,
    },
    {
      code: 'FINANCING_RECEIVED',
      nameAr: 'تمويل / قرض مستلم',
      nameEn: 'Financing Received',
      direction: TransactionDirection.IN,
      nature: TransactionNature.STANDARD,
      matchingTarget: TransactionMatchingTarget.LIABILITY,
      defaultAccountingTreatment:
        TransactionAccountingTreatment.LIABILITY_MOVEMENT,
      sortOrder: 5,
    },
    {
      code: 'OWNER_CONTRIBUTION',
      nameAr: 'مساهمة مالك / شريك',
      nameEn: 'Owner Contribution',
      direction: TransactionDirection.IN,
      nature: TransactionNature.STANDARD,
      matchingTarget: TransactionMatchingTarget.EQUITY_OR_PARTNER,
      defaultAccountingTreatment:
        TransactionAccountingTreatment.EQUITY_MOVEMENT,
      sortOrder: 6,
    },
    {
      code: 'INVESTMENT_RECEIVED',
      nameAr: 'استثمار وارد',
      nameEn: 'Investment Received',
      direction: TransactionDirection.IN,
      nature: TransactionNature.STANDARD,
      matchingTarget: TransactionMatchingTarget.INVESTMENT,
      defaultAccountingTreatment:
        TransactionAccountingTreatment.EQUITY_MOVEMENT,
      sortOrder: 7,
    },
    {
      code: 'INTERNAL_TRANSFER_IN',
      nameAr: 'تحويل وارد بين الحسابات',
      nameEn: 'Internal Transfer In',
      direction: TransactionDirection.IN,
      nature: TransactionNature.TRANSFER,
      matchingTarget: TransactionMatchingTarget.FINANCIAL_ACCOUNT,
      defaultAccountingTreatment: TransactionAccountingTreatment.TRANSFER,
      sortOrder: 8,
    },

    // -- Outgoing (OUT) -----------------------------------------------------
    {
      code: 'VENDOR_BILL_PAYMENT',
      nameAr: 'سداد فاتورة مورد',
      nameEn: 'Vendor Bill Payment',
      direction: TransactionDirection.OUT,
      nature: TransactionNature.STANDARD,
      matchingTarget: TransactionMatchingTarget.PURCHASE_INVOICE,
      defaultAccountingTreatment:
        TransactionAccountingTreatment.LIABILITY_MOVEMENT,
      sortOrder: 0,
    },
    {
      code: 'VENDOR_ADVANCE',
      nameAr: 'دفعة مقدمة لمورد',
      nameEn: 'Vendor Advance',
      direction: TransactionDirection.OUT,
      nature: TransactionNature.STANDARD,
      matchingTarget: TransactionMatchingTarget.VENDOR,
      defaultAccountingTreatment: TransactionAccountingTreatment.NEUTRAL,
      sortOrder: 1,
    },
    {
      code: 'OPERATING_EXPENSE',
      nameAr: 'مصروف تشغيلي',
      nameEn: 'Operating Expense',
      direction: TransactionDirection.OUT,
      nature: TransactionNature.STANDARD,
      matchingTarget: TransactionMatchingTarget.EXPENSE_ACCOUNT,
      defaultAccountingTreatment:
        TransactionAccountingTreatment.OPERATING_EXPENSE,
      sortOrder: 2,
    },
    {
      code: 'PAYROLL_PAYMENT',
      nameAr: 'رواتب وأجور',
      nameEn: 'Payroll Payment',
      direction: TransactionDirection.OUT,
      nature: TransactionNature.STANDARD,
      matchingTarget: TransactionMatchingTarget.EXPENSE_ACCOUNT,
      defaultAccountingTreatment:
        TransactionAccountingTreatment.OPERATING_EXPENSE,
      sortOrder: 3,
    },
    {
      code: 'EMPLOYEE_ADVANCE',
      nameAr: 'سلفة / عهدة موظف',
      nameEn: 'Employee Advance',
      direction: TransactionDirection.OUT,
      nature: TransactionNature.STANDARD,
      matchingTarget: TransactionMatchingTarget.EMPLOYEE,
      defaultAccountingTreatment: TransactionAccountingTreatment.NEUTRAL,
      sortOrder: 4,
    },
    {
      code: 'CUSTOMER_REFUND',
      nameAr: 'استرداد مبلغ لعميل',
      nameEn: 'Customer Refund',
      direction: TransactionDirection.OUT,
      nature: TransactionNature.STANDARD,
      matchingTarget: TransactionMatchingTarget.CUSTOMER,
      defaultAccountingTreatment: TransactionAccountingTreatment.NEUTRAL,
      sortOrder: 5,
    },
    {
      code: 'FINANCING_REPAYMENT',
      nameAr: 'سداد قرض / تمويل',
      nameEn: 'Financing Repayment',
      direction: TransactionDirection.OUT,
      nature: TransactionNature.STANDARD,
      matchingTarget: TransactionMatchingTarget.LIABILITY,
      defaultAccountingTreatment:
        TransactionAccountingTreatment.LIABILITY_MOVEMENT,
      sortOrder: 6,
    },
    {
      code: 'BANK_FEES',
      nameAr: 'رسوم بنكية',
      nameEn: 'Bank Fees',
      direction: TransactionDirection.OUT,
      nature: TransactionNature.STANDARD,
      matchingTarget: TransactionMatchingTarget.EXPENSE_ACCOUNT,
      defaultAccountingTreatment:
        TransactionAccountingTreatment.OPERATING_EXPENSE,
      sortOrder: 7,
    },
    {
      code: 'PROFIT_DISTRIBUTION',
      nameAr: 'توزيع أرباح',
      nameEn: 'Profit Distribution',
      direction: TransactionDirection.OUT,
      nature: TransactionNature.STANDARD,
      matchingTarget: TransactionMatchingTarget.EQUITY_OR_PARTNER,
      defaultAccountingTreatment:
        TransactionAccountingTreatment.EQUITY_MOVEMENT,
      sortOrder: 8,
    },
    {
      code: 'INTERNAL_TRANSFER_OUT',
      nameAr: 'تحويل صادر بين الحسابات',
      nameEn: 'Internal Transfer Out',
      direction: TransactionDirection.OUT,
      nature: TransactionNature.TRANSFER,
      matchingTarget: TransactionMatchingTarget.FINANCIAL_ACCOUNT,
      defaultAccountingTreatment: TransactionAccountingTreatment.TRANSFER,
      sortOrder: 9,
    },
  ] as const;

export const SYSTEM_TRANSACTION_TYPE_CODES: readonly string[] =
  SYSTEM_TRANSACTION_TYPES.map((type) => type.code);

export function isSystemTransactionTypeCode(code: string): boolean {
  return SYSTEM_TRANSACTION_TYPE_CODES.includes(code);
}
