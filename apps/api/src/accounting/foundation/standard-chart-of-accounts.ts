import { AccountType, PartnerControlAccountType } from '@prisma/client';

/**
 * Professional bilingual Chart of Accounts for the OMS e-commerce business.
 * Codes follow the existing 1→11→111 numbering convention
 * (`ROOT_CODE_BY_ACCOUNT_TYPE` + `suffixDigitWidthForParentLevel`).
 *
 * `aliases` map legacy seed codes (AR, CASH, …) so production accounts are
 * reused rather than duplicated.
 */
export type PostingRole =
  | 'CASH'
  | 'BANK'
  | 'AR'
  | 'INVENTORY'
  | 'PREPAYMENTS'
  | 'FIXED_ASSETS'
  | 'ACCUM_DEPRECIATION'
  | 'VAT_INPUT'
  | 'AP'
  | 'VAT_OUTPUT'
  | 'ACCRUED_SHIPPING'
  | 'ACCRUED_FULFILLMENT'
  | 'ACCRUED_EXPENSES'
  | 'PAYROLL_PAYABLE'
  | 'INVESTOR_FUNDING'
  | 'INVESTOR_PAYABLE'
  | 'CAPITAL'
  | 'RETAINED_EARNINGS'
  | 'SALES_REVENUE'
  | 'SERVICE_REVENUE'
  | 'SALES_RETURNS'
  | 'SALES_DISCOUNTS'
  | 'OTHER_INCOME'
  | 'COGS'
  | 'SHIPPING_EXPENSE'
  | 'GATEWAY_FEES'
  | 'FULFILLMENT_EXPENSE'
  | 'OPERATING_EXPENSE'
  | 'SALARY_EXPENSE'
  | 'KPI_EXPENSE'
  | 'COMMISSION_EXPENSE'
  | 'ALLOWANCE_EXPENSE'
  | 'INVENTORY_ADJUSTMENT'
  | 'PURCHASE'
  | 'PURCHASE_RETURN'
  | 'PURCHASE_DISCOUNT'
  | 'LANDED_COST_CLEARING'
  | 'EXCHANGE_DIFF'
  | 'ROUND_DIFF'
  | 'SUSPENSE'
  | 'INVESTOR_DIST'
  | 'DEDUCTION'
  | 'CAPITAL_RETURN'
  | 'OTHER_EXPENSE';

export interface StandardAccountDef {
  code: string;
  name: string;
  nameEn: string;
  accountType: AccountType;
  parentCode: string | null;
  allowsPosting: boolean;
  allowReconciliation?: boolean;
  partnerControlType?: PartnerControlAccountType;
  isSystemAccount?: boolean;
  aliases?: string[];
  role?: PostingRole;
}

export const STANDARD_CHART_OF_ACCOUNTS: StandardAccountDef[] = [
  {
    code: '1',
    name: 'الأصول',
    nameEn: 'Assets',
    accountType: AccountType.ASSET,
    parentCode: null,
    allowsPosting: false,
    isSystemAccount: true,
  },
  {
    code: '2',
    name: 'الالتزامات',
    nameEn: 'Liabilities',
    accountType: AccountType.LIABILITY,
    parentCode: null,
    allowsPosting: false,
    isSystemAccount: true,
  },
  {
    code: '3',
    name: 'حقوق الملكية',
    nameEn: 'Equity',
    accountType: AccountType.EQUITY,
    parentCode: null,
    allowsPosting: false,
    isSystemAccount: true,
  },
  {
    code: '4',
    name: 'الإيرادات',
    nameEn: 'Revenue',
    accountType: AccountType.REVENUE,
    parentCode: null,
    allowsPosting: false,
    isSystemAccount: true,
  },
  {
    code: '5',
    name: 'المصروفات',
    nameEn: 'Expenses',
    accountType: AccountType.EXPENSE,
    parentCode: null,
    allowsPosting: false,
    isSystemAccount: true,
  },

  // --- Assets ---
  {
    code: '11',
    name: 'النقدية والبنوك',
    nameEn: 'Cash and Banks',
    accountType: AccountType.ASSET,
    parentCode: '1',
    allowsPosting: false,
  },
  {
    code: '111',
    name: 'الصندوق',
    nameEn: 'Cash on Hand',
    accountType: AccountType.ASSET,
    parentCode: '11',
    allowsPosting: true,
    allowReconciliation: true,
    aliases: ['CASH'],
    role: 'CASH',
  },
  {
    code: '112',
    name: 'البنوك',
    nameEn: 'Banks',
    accountType: AccountType.ASSET,
    parentCode: '11',
    allowsPosting: true,
    allowReconciliation: true,
    role: 'BANK',
  },
  {
    code: '12',
    name: 'العملاء',
    nameEn: 'Accounts Receivable',
    accountType: AccountType.ASSET,
    parentCode: '1',
    allowsPosting: false,
  },
  {
    code: '121',
    name: 'الذمم المدينة التجارية',
    nameEn: 'Trade Receivables',
    accountType: AccountType.ASSET,
    parentCode: '12',
    allowsPosting: true,
    allowReconciliation: true,
    partnerControlType: PartnerControlAccountType.RECEIVABLE,
    aliases: ['AR'],
    role: 'AR',
  },
  {
    code: '13',
    name: 'المخزون',
    nameEn: 'Inventory',
    accountType: AccountType.ASSET,
    parentCode: '1',
    allowsPosting: false,
  },
  {
    code: '131',
    name: 'مخزون البضاعة',
    nameEn: 'Merchandise Inventory',
    accountType: AccountType.ASSET,
    parentCode: '13',
    allowsPosting: true,
    aliases: ['INV'],
    role: 'INVENTORY',
  },
  {
    code: '14',
    name: 'المصروفات المقدمة',
    nameEn: 'Prepayments',
    accountType: AccountType.ASSET,
    parentCode: '1',
    allowsPosting: false,
  },
  {
    code: '141',
    name: 'مصروفات مدفوعة مقدماً',
    nameEn: 'Prepaid Expenses',
    accountType: AccountType.ASSET,
    parentCode: '14',
    allowsPosting: true,
    role: 'PREPAYMENTS',
  },
  {
    code: '15',
    name: 'الأصول الثابتة',
    nameEn: 'Fixed Assets',
    accountType: AccountType.ASSET,
    parentCode: '1',
    allowsPosting: false,
  },
  {
    code: '151',
    name: 'الأثاث والتجهيزات',
    nameEn: 'Furniture and Equipment',
    accountType: AccountType.ASSET,
    parentCode: '15',
    allowsPosting: true,
    role: 'FIXED_ASSETS',
  },
  {
    code: '152',
    name: 'مجمع الإهلاك',
    nameEn: 'Accumulated Depreciation',
    accountType: AccountType.ASSET,
    parentCode: '15',
    allowsPosting: true,
    role: 'ACCUM_DEPRECIATION',
  },
  {
    code: '16',
    name: 'ضريبة المدخلات',
    nameEn: 'VAT Input',
    accountType: AccountType.ASSET,
    parentCode: '1',
    allowsPosting: false,
  },
  {
    code: '161',
    name: 'ضريبة القيمة المضافة - مدخلات',
    nameEn: 'VAT Input Receivable',
    accountType: AccountType.ASSET,
    parentCode: '16',
    allowsPosting: true,
    aliases: ['VATIN'],
    role: 'VAT_INPUT',
  },

  // --- Liabilities ---
  {
    code: '21',
    name: 'الموردون',
    nameEn: 'Accounts Payable',
    accountType: AccountType.LIABILITY,
    parentCode: '2',
    allowsPosting: false,
  },
  {
    code: '211',
    name: 'الذمم الدائنة التجارية',
    nameEn: 'Trade Payables',
    accountType: AccountType.LIABILITY,
    parentCode: '21',
    allowsPosting: true,
    allowReconciliation: true,
    partnerControlType: PartnerControlAccountType.PAYABLE,
    aliases: ['AP'],
    role: 'AP',
  },
  {
    code: '22',
    name: 'الالتزامات الضريبية',
    nameEn: 'Tax Liabilities',
    accountType: AccountType.LIABILITY,
    parentCode: '2',
    allowsPosting: false,
  },
  {
    code: '221',
    name: 'ضريبة القيمة المضافة - مخرجات',
    nameEn: 'VAT Output Payable',
    accountType: AccountType.LIABILITY,
    parentCode: '22',
    allowsPosting: true,
    aliases: ['VATOUT'],
    role: 'VAT_OUTPUT',
  },
  {
    code: '23',
    name: 'المستحقات',
    nameEn: 'Accruals',
    accountType: AccountType.LIABILITY,
    parentCode: '2',
    allowsPosting: false,
  },
  {
    code: '231',
    name: 'مصروف شحن مستحق',
    nameEn: 'Accrued Shipping',
    accountType: AccountType.LIABILITY,
    parentCode: '23',
    allowsPosting: true,
    role: 'ACCRUED_SHIPPING',
  },
  {
    code: '232',
    name: 'تكلفة تجهيز مستحقة',
    nameEn: 'Accrued Fulfillment',
    accountType: AccountType.LIABILITY,
    parentCode: '23',
    allowsPosting: true,
    role: 'ACCRUED_FULFILLMENT',
  },
  {
    code: '233',
    name: 'مصروفات مستحقة',
    nameEn: 'Accrued Expenses',
    accountType: AccountType.LIABILITY,
    parentCode: '23',
    allowsPosting: true,
    role: 'ACCRUED_EXPENSES',
  },
  {
    code: '234',
    name: 'رواتب مستحقة',
    nameEn: 'Payroll Payable',
    accountType: AccountType.LIABILITY,
    parentCode: '23',
    allowsPosting: true,
    role: 'PAYROLL_PAYABLE',
  },
  {
    code: '24',
    name: 'التزامات المستثمرين',
    nameEn: 'Investor Liabilities',
    accountType: AccountType.LIABILITY,
    parentCode: '2',
    allowsPosting: false,
  },
  {
    code: '241',
    name: 'تمويل المستثمرين',
    nameEn: 'Investor Funding',
    accountType: AccountType.LIABILITY,
    parentCode: '24',
    allowsPosting: true,
    aliases: ['INVFUND'],
    role: 'INVESTOR_FUNDING',
  },
  {
    code: '242',
    name: 'أرباح مستثمرين مستحقة',
    nameEn: 'Investor Profit Payable',
    accountType: AccountType.LIABILITY,
    parentCode: '24',
    allowsPosting: true,
    aliases: ['INVPAY'],
    role: 'INVESTOR_PAYABLE',
  },

  // --- Equity ---
  {
    code: '31',
    name: 'رأس المال',
    nameEn: 'Capital',
    accountType: AccountType.EQUITY,
    parentCode: '3',
    allowsPosting: false,
  },
  {
    code: '311',
    name: 'رأس مال الشركة',
    nameEn: 'Share Capital',
    accountType: AccountType.EQUITY,
    parentCode: '31',
    allowsPosting: true,
    role: 'CAPITAL',
  },
  {
    code: '32',
    name: 'الأرباح المحتجزة',
    nameEn: 'Retained Earnings',
    accountType: AccountType.EQUITY,
    parentCode: '3',
    allowsPosting: false,
  },
  {
    code: '321',
    name: 'أرباح مبقاة',
    nameEn: 'Retained Earnings',
    accountType: AccountType.EQUITY,
    parentCode: '32',
    allowsPosting: true,
    role: 'RETAINED_EARNINGS',
  },

  // --- Revenue ---
  {
    code: '41',
    name: 'إيرادات المبيعات',
    nameEn: 'Sales Revenue',
    accountType: AccountType.REVENUE,
    parentCode: '4',
    allowsPosting: false,
  },
  {
    code: '411',
    name: 'مبيعات المنتجات',
    nameEn: 'Product Sales',
    accountType: AccountType.REVENUE,
    parentCode: '41',
    allowsPosting: true,
    aliases: ['REV'],
    role: 'SALES_REVENUE',
  },
  {
    code: '412',
    name: 'مبيعات الخدمات',
    nameEn: 'Service Sales',
    accountType: AccountType.REVENUE,
    parentCode: '41',
    allowsPosting: true,
    role: 'SERVICE_REVENUE',
  },
  {
    code: '42',
    name: 'المرتجعات والخصومات',
    nameEn: 'Returns and Discounts',
    accountType: AccountType.REVENUE,
    parentCode: '4',
    allowsPosting: false,
  },
  {
    code: '421',
    name: 'مردودات المبيعات',
    nameEn: 'Sales Returns',
    accountType: AccountType.REVENUE,
    parentCode: '42',
    allowsPosting: true,
    role: 'SALES_RETURNS',
  },
  {
    code: '422',
    name: 'خصومات المبيعات',
    nameEn: 'Sales Discounts',
    accountType: AccountType.REVENUE,
    parentCode: '42',
    allowsPosting: true,
    role: 'SALES_DISCOUNTS',
  },
  {
    code: '43',
    name: 'إيرادات أخرى',
    nameEn: 'Other Income',
    accountType: AccountType.REVENUE,
    parentCode: '4',
    allowsPosting: false,
  },
  {
    code: '431',
    name: 'إيرادات متنوعة',
    nameEn: 'Miscellaneous Income',
    accountType: AccountType.REVENUE,
    parentCode: '43',
    allowsPosting: true,
    role: 'OTHER_INCOME',
  },

  // --- Expenses ---
  {
    code: '51',
    name: 'تكلفة البضاعة المباعة',
    nameEn: 'Cost of Goods Sold',
    accountType: AccountType.EXPENSE,
    parentCode: '5',
    allowsPosting: false,
  },
  {
    code: '511',
    name: 'تكلفة المبيعات',
    nameEn: 'Cost of Goods Sold',
    accountType: AccountType.EXPENSE,
    parentCode: '51',
    allowsPosting: true,
    aliases: ['COGS'],
    role: 'COGS',
  },
  {
    code: '52',
    name: 'التكاليف التشغيلية المباشرة',
    nameEn: 'Direct Operating Costs',
    accountType: AccountType.EXPENSE,
    parentCode: '5',
    allowsPosting: false,
  },
  {
    code: '521',
    name: 'الشحن والتوصيل',
    nameEn: 'Shipping / Carrier',
    accountType: AccountType.EXPENSE,
    parentCode: '52',
    allowsPosting: true,
    role: 'SHIPPING_EXPENSE',
  },
  {
    code: '522',
    name: 'عمولات بوابات الدفع',
    nameEn: 'Payment Gateway Fees',
    accountType: AccountType.EXPENSE,
    parentCode: '52',
    allowsPosting: true,
    role: 'GATEWAY_FEES',
  },
  {
    code: '523',
    name: 'التجهيز والتعبئة',
    nameEn: 'Fulfillment / Packaging',
    accountType: AccountType.EXPENSE,
    parentCode: '52',
    allowsPosting: true,
    role: 'FULFILLMENT_EXPENSE',
  },
  {
    code: '53',
    name: 'المصروفات التشغيلية',
    nameEn: 'Operating Expenses',
    accountType: AccountType.EXPENSE,
    parentCode: '5',
    allowsPosting: false,
  },
  {
    code: '531',
    name: 'مصروفات عامة',
    nameEn: 'General Expenses',
    accountType: AccountType.EXPENSE,
    parentCode: '53',
    allowsPosting: true,
    aliases: ['EXP'],
    role: 'OPERATING_EXPENSE',
  },
  {
    code: '532',
    name: 'الرواتب',
    nameEn: 'Salaries',
    accountType: AccountType.EXPENSE,
    parentCode: '53',
    allowsPosting: true,
    role: 'SALARY_EXPENSE',
  },
  {
    code: '533',
    name: 'حوافز الأداء',
    nameEn: 'KPI Incentives',
    accountType: AccountType.EXPENSE,
    parentCode: '53',
    allowsPosting: true,
    role: 'KPI_EXPENSE',
  },
  {
    code: '534',
    name: 'العمولات',
    nameEn: 'Commissions',
    accountType: AccountType.EXPENSE,
    parentCode: '53',
    allowsPosting: true,
    role: 'COMMISSION_EXPENSE',
  },
  {
    code: '535',
    name: 'البدلات',
    nameEn: 'Allowances',
    accountType: AccountType.EXPENSE,
    parentCode: '53',
    allowsPosting: true,
    role: 'ALLOWANCE_EXPENSE',
  },
  {
    code: '54',
    name: 'مصروفات أخرى',
    nameEn: 'Other Expenses',
    accountType: AccountType.EXPENSE,
    parentCode: '5',
    allowsPosting: false,
  },
  {
    code: '541',
    name: 'تسويات المخزون',
    nameEn: 'Inventory Adjustments',
    accountType: AccountType.EXPENSE,
    parentCode: '54',
    allowsPosting: true,
    role: 'INVENTORY_ADJUSTMENT',
  },
  {
    code: '542',
    name: 'مشتريات غير مخزنية',
    nameEn: 'Non-Inventory Purchases',
    accountType: AccountType.EXPENSE,
    parentCode: '54',
    allowsPosting: true,
    role: 'PURCHASE',
  },
  {
    code: '543',
    name: 'مردودات المشتريات',
    nameEn: 'Purchase Returns',
    accountType: AccountType.EXPENSE,
    parentCode: '54',
    allowsPosting: true,
    role: 'PURCHASE_RETURN',
  },
  {
    code: '544',
    name: 'خصومات المشتريات',
    nameEn: 'Purchase Discounts',
    accountType: AccountType.EXPENSE,
    parentCode: '54',
    allowsPosting: true,
    role: 'PURCHASE_DISCOUNT',
  },
  {
    code: '545',
    name: 'مقاصة التكاليف اللوجستية',
    nameEn: 'Landed Cost Clearing',
    accountType: AccountType.EXPENSE,
    parentCode: '54',
    allowsPosting: true,
    role: 'LANDED_COST_CLEARING',
  },
  {
    code: '546',
    name: 'فروقات العملة',
    nameEn: 'Exchange Differences',
    accountType: AccountType.EXPENSE,
    parentCode: '54',
    allowsPosting: true,
    role: 'EXCHANGE_DIFF',
  },
  {
    code: '547',
    name: 'فروقات التقريب',
    nameEn: 'Rounding Differences',
    accountType: AccountType.EXPENSE,
    parentCode: '54',
    allowsPosting: true,
    role: 'ROUND_DIFF',
  },
  {
    code: '548',
    name: 'حساب وسيط',
    nameEn: 'Suspense',
    accountType: AccountType.EXPENSE,
    parentCode: '54',
    allowsPosting: true,
    role: 'SUSPENSE',
  },
  {
    code: '549',
    name: 'توزيع أرباح المستثمرين',
    nameEn: 'Investor Profit Distribution',
    accountType: AccountType.EXPENSE,
    parentCode: '54',
    allowsPosting: true,
    aliases: ['INVDIST'],
    role: 'INVESTOR_DIST',
  },
  {
    code: '550',
    name: 'استقطاعات الرواتب',
    nameEn: 'Payroll Deductions',
    accountType: AccountType.EXPENSE,
    parentCode: '54',
    allowsPosting: true,
    role: 'DEDUCTION',
  },
  {
    code: '551',
    name: 'رد رأس المال',
    nameEn: 'Capital Return',
    accountType: AccountType.EXPENSE,
    parentCode: '54',
    allowsPosting: true,
    role: 'CAPITAL_RETURN',
  },
  {
    code: '552',
    name: 'مصروفات متنوعة',
    nameEn: 'Miscellaneous Expenses',
    accountType: AccountType.EXPENSE,
    parentCode: '54',
    allowsPosting: true,
    role: 'OTHER_EXPENSE',
  },
];

export const POSTING_ROLE_SETTINGS: Record<PostingRole, string | null> = {
  CASH: 'cashAccountId',
  BANK: 'bankAccountId',
  AR: 'accountsReceivableAccountId',
  INVENTORY: 'inventoryAccountId',
  PREPAYMENTS: null,
  FIXED_ASSETS: null,
  ACCUM_DEPRECIATION: null,
  VAT_INPUT: 'vatInputAccountId',
  AP: 'accountsPayableAccountId',
  VAT_OUTPUT: 'vatOutputAccountId',
  ACCRUED_SHIPPING: 'accruedShippingAccountId',
  ACCRUED_FULFILLMENT: 'accruedFulfillmentAccountId',
  ACCRUED_EXPENSES: null,
  PAYROLL_PAYABLE: 'payrollPayableAccountId',
  INVESTOR_FUNDING: 'investorFundingAccountId',
  INVESTOR_PAYABLE: 'investorProfitPayableAccountId',
  CAPITAL: null,
  RETAINED_EARNINGS: 'retainedEarningsAccountId',
  SALES_REVENUE: 'salesRevenueAccountId',
  SERVICE_REVENUE: null,
  SALES_RETURNS: 'salesReturnAccountId',
  SALES_DISCOUNTS: 'salesDiscountAccountId',
  OTHER_INCOME: null,
  COGS: 'costOfGoodsSoldAccountId',
  SHIPPING_EXPENSE: 'shippingExpenseAccountId',
  GATEWAY_FEES: 'paymentGatewayFeeAccountId',
  FULFILLMENT_EXPENSE: 'fulfillmentExpenseAccountId',
  OPERATING_EXPENSE: 'defaultExpenseAccountId',
  SALARY_EXPENSE: 'salaryExpenseAccountId',
  KPI_EXPENSE: 'kpiExpenseAccountId',
  COMMISSION_EXPENSE: 'commissionExpenseAccountId',
  ALLOWANCE_EXPENSE: 'defaultAllowanceExpenseAccountId',
  INVENTORY_ADJUSTMENT: 'inventoryAdjustmentAccountId',
  PURCHASE: 'purchaseAccountId',
  PURCHASE_RETURN: 'purchaseReturnAccountId',
  PURCHASE_DISCOUNT: 'purchaseDiscountAccountId',
  LANDED_COST_CLEARING: 'landedCostClearingAccountId',
  EXCHANGE_DIFF: 'exchangeDifferenceAccountId',
  ROUND_DIFF: 'roundDifferenceAccountId',
  SUSPENSE: 'suspenseAccountId',
  INVESTOR_DIST: 'investorProfitDistributionAccountId',
  DEDUCTION: 'defaultDeductionAccountId',
  CAPITAL_RETURN: 'capitalReturnAccountId',
  OTHER_EXPENSE: null,
};
