import 'dotenv/config';
import {
  AccountType,
  JournalType,
  PrismaClient,
  ShippingMethodType,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { ALL_PERMISSION_NAMES } from '../src/permissions/permission-catalog';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// One permission per top-level sidebar module (see apps/web navigation.config.ts
// module ids) — the dynamic sidebar hides any module the user's role doesn't grant.
const modulePermissions = [
  'crm.view',
  'sales.view',
  'purchasing.view',
  'products.view',
  'inventory.view',
  'expenses.view',
  'finance.view',
  'masterdata.view',
  'datamanagement.view',
  'reports.view',
  'settings.view',
];

// Master Data Foundation (TASK-023/024) — one View/Create/Edit/Archive
// permission per entity, finer-grained than the module-level permissions
// above. "Delete" has no separate permission: every Master Data entity is
// soft-delete-only (same rule as Products/Suppliers), so the UI's Delete
// action IS Archive. Companies/Branches are deliberately absent — TASK-024
// removed their admin module (single-company MVP); the underlying
// Company/Branch auth-context tables and seed data below are untouched.
const masterDataEntities = [
  'warehouses',
  'currencies',
  'taxes',
  'units',
  'categories',
  'brands',
  'analytic-plans',
  'analytic-accounts',
  'payment-methods',
  'shipping-methods',
  'customer-groups',
  'supplier-groups',
  'countries',
  'cities',
  'languages',
  // TASK-048 — Cost Centers/Projects direct entry points.
  'cost-centers',
  'projects',
  // TASK-053 — Chart of Accounts was never added here despite the frontend
  // already gating its +New/Edit/Archive actions on
  // "masterdata.chart-of-accounts.*"; Journals is the new entity this task adds.
  'chart-of-accounts',
  'journals',
  // System-Wide Data-Entry Standard pass — Expenses, Fixed Assets.
  'expenses',
  'fixed-assets',
];
const masterDataActions = ['view', 'create', 'edit', 'archive'];
const masterDataPermissions = masterDataEntities.flatMap((entity) =>
  masterDataActions.map((action) => `masterdata.${entity}.${action}`),
);

// Settings > Document Numbering (TASK-026 Part 1) — granular admin-only
// permission, same pattern as Master Data's per-entity permissions above but
// for a single system-config surface: only Administrator gets it, so
// "users cannot modify numbering" is enforced the same UI-side way every
// permission in this codebase is enforced today.
const settingsPermissions = ['numbering.manage'];

// Fiscal Years & Accounting Periods (TASK-051 Phase 2) — Administrator-only,
// same treatment as numbering.manage: a single system-config capability, not
// a per-entity create/edit/archive split.
const accountingPeriodPermissions = ['accounting.fiscal-years.manage'];

// Products (TASK-027) — granular action permissions alongside the existing
// `products.view` module permission, same create/edit/archive split Master
// Data uses (no separate "delete": archive IS delete, soft-delete only).
const productPermissions = [
  'products.create',
  'products.edit',
  'products.archive',
];

// Inventory (TASK-048) — granular create permissions alongside the existing
// `inventory.view` module permission, gating the previously-ungated
// "+ New" actions on Movements (Opening Balance/Adjustment/Transfer, one
// combined action) and Physical Count. No edit/archive counterpart: a
// Movement is an append-only ledger row (ADR-0013, never edited/archived)
// and Physical Count has no archive endpoint — only Confirm/Cancel, which
// stay ungated same as every other document's workflow transition.
const inventoryPermissions = [
  'inventory.movements.create',
  'inventory.physical-count.create',
];

// Sales Quotation (TASK-040) — the SalesDocumentEditor shell gates the entire
// form's editability on `permissions.edit` (not just the Approve/Cancel
// buttons), so `.edit` must be granted alongside `.create`/`.approve`/
// `.cancel` for the module to be usable at all.
const salesQuotationPermissions = [
  'sales.quotations.create',
  'sales.quotations.edit',
  'sales.quotations.approve',
  'sales.quotations.cancel',
];

// Sales Order / Invoice / Return — same shell-gating requirement as
// Quotation above, plus `.confirm` (Reserve/Reduce/Increase Inventory),
// a workflow step Quotation's lifecycle doesn't have.
const salesOrderPermissions = [
  'sales.orders.create',
  'sales.orders.edit',
  'sales.orders.approve',
  'sales.orders.confirm',
  'sales.orders.cancel',
];
const salesInvoicePermissions = [
  'sales.invoices.create',
  'sales.invoices.edit',
  'sales.invoices.approve',
  'sales.invoices.confirm',
  'sales.invoices.cancel',
];
const salesReturnPermissions = [
  'sales.returns.create',
  'sales.returns.edit',
  'sales.returns.approve',
  'sales.returns.confirm',
  'sales.returns.cancel',
];

// TASK-054 — Purchasing Quotation/Order/Invoice/Return, Sales Receipt/
// Supplier Payment, and Manual Journal Entry permissions were referenced by
// every one of these pages' `hasPermission()` calls / `PurchaseDocumentEditor`
// `permissions` config since they were built, but were never added to this
// seed file — every "+New"/Approve/Confirm/Cancel/Post/Reverse action on
// these pages was invisible to every role, including Administrator.
const purchasingQuotationPermissions = [
  'purchasing.quotations.create',
  'purchasing.quotations.edit',
  'purchasing.quotations.approve',
  'purchasing.quotations.cancel',
];
const purchasingOrderPermissions = [
  'purchasing.orders.create',
  'purchasing.orders.edit',
  'purchasing.orders.approve',
  'purchasing.orders.cancel',
];
const purchasingInvoicePermissions = [
  'purchasing.invoices.create',
  'purchasing.invoices.edit',
  'purchasing.invoices.approve',
  'purchasing.invoices.cancel',
  'purchasing.invoices.confirm',
];
const purchasingReturnPermissions = [
  'purchasing.returns.create',
  'purchasing.returns.edit',
  'purchasing.returns.approve',
  'purchasing.returns.cancel',
  'purchasing.returns.confirm',
];
const purchasingPaymentPermissions = [
  'purchasing.payments.create',
  'purchasing.payments.edit',
  'purchasing.payments.confirm',
  'purchasing.payments.cancel',
];
const salesReceiptPermissions = [
  'sales.receipts.create',
  'sales.receipts.edit',
  'sales.receipts.confirm',
  'sales.receipts.cancel',
];
const journalEntryPermissions = [
  'accounting.journal-entries.create',
  'accounting.journal-entries.post',
  'accounting.journal-entries.reverse',
  'accounting.journal-entries.archive',
];
const importCenterPermissions = ['import-center.manage'];

// TASK-060 Part 2 — the closed, fixed Job Title list. Labels only; never joined into a permission check.
const jobTitles = [
  'مدير النظام',
  'المدير العام',
  'المدير المالي',
  'المحاسب',
  'مدير المبيعات',
  'مدير التشغيل',
  'موظف خدمة العملاء',
  'موظف الشحن',
];

const companies = [
  {
    name: 'Acme Trading',
    code: 'ACME',
    primaryColor: '#0F8A5F',
    secondaryColor: '#2563EB',
  },
  {
    name: 'Nova Retail',
    code: 'NOVA',
    primaryColor: '#0F8A5F',
    secondaryColor: '#2563EB',
  },
];

const branches = [
  { companyCode: 'ACME', name: 'Main Branch', code: 'MAIN' },
  { companyCode: 'ACME', name: 'Warehouse Branch', code: 'WH' },
  { companyCode: 'NOVA', name: 'Head Office', code: 'HQ' },
];

const currencies = [
  { code: 'SAR', name: 'ريال سعودي', symbol: 'ر.س' },
  { code: 'EGP', name: 'جنيه مصري', symbol: 'ج.م' },
  { code: 'USD', name: 'دولار أمريكي', symbol: '$' },
  { code: 'AED', name: 'درهم إماراتي', symbol: 'د.إ' },
];

const countries = [
  { code: 'SA', name: 'المملكة العربية السعودية' },
  { code: 'EG', name: 'مصر' },
  { code: 'AE', name: 'الإمارات العربية المتحدة' },
];

// TASK-024 Part 6 demo data — one internal delivery method plus the named
// external carriers a Saudi merchant actually ships with.
const shippingMethods = [
  { name: 'توصيل داخلي', type: ShippingMethodType.INTERNAL_DELIVERY },
  { name: 'SMSA', type: ShippingMethodType.EXTERNAL_COMPANY },
  { name: 'Aramex', type: ShippingMethodType.EXTERNAL_COMPANY },
  { name: 'DHL', type: ShippingMethodType.EXTERNAL_COMPANY },
  { name: 'FedEx', type: ShippingMethodType.EXTERNAL_COMPANY },
];
/// Old English demo rows this reseed replaces — deleted by name before the
/// new rows are created (ShippingMethod is name-unique, so re-running the
/// seed can't just "update in place" the way code-keyed entities do).
const obsoleteShippingMethodNames = ['Internal Delivery', 'Shipping Company'];

const paymentSources = [
  { name: 'Bank Transfer' },
  { name: 'Wallet' },
  { name: 'InstaPay' },
  { name: 'Cash Deposit' },
  { name: 'Payment Gateway' },
  { name: 'Other' },
];

const units = [
  { name: 'قطعة' },
  { name: 'صندوق' },
  { name: 'عبوة' },
  { name: 'كتاب' },
  { name: 'كرتون' },
  { name: 'كيلوجرام' },
  { name: 'جرام' },
  { name: 'لتر' },
  { name: 'متر' },
];
/// Old English demo rows this reseed replaces (see obsoleteShippingMethodNames).
const obsoleteUnitNames = [
  'Piece',
  'Box',
  'Pack',
  'Book',
  'Carton',
  'Kilogram',
  'Gram',
  'Liter',
  'Meter',
];

const productCategories = [
  { name: 'كتب', description: 'الكتب والمواد المطبوعة' },
  { name: 'دورات', description: 'الدورات التدريبية والتعليمية' },
  { name: 'اشتراكات', description: 'خدمات الاشتراك الدورية' },
];
const obsoleteProductCategoryNames = [
  'Electronics',
  'Apparel',
  'Home & Kitchen',
];

const productBrands = [
  { name: 'محبرة', description: 'علامة تجارية للقرطاسية والمستلزمات المكتبية' },
  { name: 'حاسب', description: 'علامة تجارية للأجهزة الإلكترونية والحاسوبية' },
];
const obsoleteProductBrandNames = ['Generic', 'Acme Premium'];

const seedPaymentMethods = [
  { name: 'تحويل بنكي' },
  { name: 'نقداً' },
  { name: 'Apple Pay' },
  { name: 'بطاقة ائتمانية' },
];
const obsoletePaymentMethodNames = [
  'Cash on Delivery',
  'Credit Card',
  'Bank Transfer',
];

const seedCostCenters = [
  { code: 'CC-ADMIN', name: 'الإدارة' },
  { code: 'CC-MKT', name: 'التسويق' },
  { code: 'CC-SALES', name: 'المبيعات' },
  { code: 'CC-OPS', name: 'العمليات' },
];

const seedWarehouses = [
  {
    code: 'WH-MAIN',
    name: 'المخزن الرئيسي',
    isDefault: true,
    warehouseType: 'رئيسي',
  },
  {
    code: 'WH-JED',
    name: 'مستودع جدة',
    isDefault: false,
    warehouseType: 'فرعي',
  },
  {
    code: 'WH-RET',
    name: 'مستودع المرتجعات',
    isDefault: false,
    warehouseType: 'مرتجعات',
  },
];

const taxes = [
  { code: 'VAT15', name: 'ضريبة القيمة المضافة 15%', rate: 15 },
  { code: 'VAT0', name: 'معفى من الضريبة', rate: 0 },
];

// Accounting Posting Engine (TASK-046) — the minimal Chart of Accounts the
// default Posting Providers need to post anything at all. Without these
// (and PostingSettings pointing at them, seeded below), every Sales/
// Purchase Invoice confirm() would fail its now-mandatory posting step.
const postingChartOfAccounts = [
  { code: 'AR', name: 'Accounts Receivable', accountType: AccountType.ASSET },
  { code: 'AP', name: 'Accounts Payable', accountType: AccountType.LIABILITY },
  { code: 'INV', name: 'Inventory', accountType: AccountType.ASSET },
  {
    code: 'COGS',
    name: 'Cost of Goods Sold',
    accountType: AccountType.EXPENSE,
  },
  { code: 'REV', name: 'Sales Revenue', accountType: AccountType.REVENUE },
  { code: 'EXP', name: 'General Expense', accountType: AccountType.EXPENSE },
  {
    code: 'VATOUT',
    name: 'VAT Output (Payable)',
    accountType: AccountType.LIABILITY,
  },
  {
    code: 'VATIN',
    name: 'VAT Input (Receivable)',
    accountType: AccountType.ASSET,
  },
  { code: 'CASH', name: 'Cash / Bank', accountType: AccountType.ASSET },
];

const customerGroups = [
  { code: 'RETAIL', name: 'عملاء التجزئة' },
  { code: 'WHOLESALE', name: 'عملاء الجملة' },
];

const supplierGroups = [
  { code: 'LOCAL', name: 'موردون محليون' },
  { code: 'IMPORT', name: 'موردون مستوردون' },
];

const languages = [
  {
    code: 'ar',
    name: 'العربية',
    nativeName: 'العربية',
    direction: 'RTL' as const,
  },
  {
    code: 'en',
    name: 'الإنجليزية',
    nativeName: 'English',
    direction: 'LTR' as const,
  },
];

const cities = [
  { countryCode: 'SA', code: 'RUH', name: 'الرياض' },
  { countryCode: 'SA', code: 'JED', name: 'جدة' },
  { countryCode: 'SA', code: 'DMM', name: 'الدمام' },
  { countryCode: 'SA', code: 'MKS', name: 'مكة المكرمة' },
  { countryCode: 'SA', code: 'MED', name: 'المدينة المنورة' },
  { countryCode: 'EG', code: 'CAI', name: 'القاهرة' },
  { countryCode: 'EG', code: 'ALX', name: 'الإسكندرية' },
  { countryCode: 'AE', code: 'DXB', name: 'دبي' },
];

const costComponents = [
  { code: 'PRODUCT_COST', name: 'Product Cost' },
  { code: 'PRINTING', name: 'Printing' },
  { code: 'PACKAGING', name: 'Packaging' },
  { code: 'CUSTOM_BOX', name: 'Custom Box' },
  { code: 'CUSTOMS', name: 'Customs' },
  { code: 'INBOUND_SHIPPING', name: 'Inbound Shipping' },
  { code: 'OUTBOUND_PREPARATION', name: 'Outbound Preparation' },
  { code: 'OTHER', name: 'Other' },
];

async function main() {
  await Promise.all(
    currencies.map((currency) =>
      prisma.currency.upsert({
        where: { code: currency.code },
        update: currency,
        create: currency,
      }),
    ),
  );

  await Promise.all(
    countries.map((country) =>
      prisma.country.upsert({
        where: { code: country.code },
        update: country,
        create: country,
      }),
    ),
  );

  // Name-unique — a reseed can't "update in place" onto a renamed row, so
  // the old English demo rows are removed first (TASK-024 Part 6: Arabic demo data).
  await prisma.shippingMethod.deleteMany({
    where: { name: { in: obsoleteShippingMethodNames } },
  });
  await Promise.all(
    shippingMethods.map((method) =>
      prisma.shippingMethod.upsert({
        where: { name: method.name },
        update: method,
        create: method,
      }),
    ),
  );

  await Promise.all(
    paymentSources.map((source) =>
      prisma.paymentSource.upsert({
        where: { name: source.name },
        update: {},
        create: source,
      }),
    ),
  );

  await prisma.paymentMethod.deleteMany({
    where: { name: { in: obsoletePaymentMethodNames } },
  });
  await Promise.all(
    seedPaymentMethods.map((method) =>
      prisma.paymentMethod.upsert({
        where: { name: method.name },
        update: method,
        create: method,
      }),
    ),
  );

  await prisma.unit.deleteMany({ where: { name: { in: obsoleteUnitNames } } });
  await Promise.all(
    units.map((unit) =>
      prisma.unit.upsert({
        where: { name: unit.name },
        update: unit,
        create: unit,
      }),
    ),
  );

  await Promise.all(
    costComponents.map((component) =>
      prisma.costComponent.upsert({
        where: { code: component.code },
        update: {},
        create: component,
      }),
    ),
  );

  // --- Master Data Foundation (TASK-023/024) ---------------------------------
  await prisma.productCategory.deleteMany({
    where: { name: { in: obsoleteProductCategoryNames } },
  });
  // Not a plain `upsert` — `ProductCategory.name` is only unique among
  // active (non-archived) rows (a partial index, not expressible as a
  // Prisma `@unique`), so lookup has to filter `deletedAt: null` itself.
  await Promise.all(
    productCategories.map(async (category) => {
      const existing = await prisma.productCategory.findFirst({
        where: { name: category.name, deletedAt: null },
      });
      return existing
        ? prisma.productCategory.update({
            where: { id: existing.id },
            data: category,
          })
        : prisma.productCategory.create({ data: category });
    }),
  );

  await prisma.productBrand.deleteMany({
    where: { name: { in: obsoleteProductBrandNames } },
  });
  await Promise.all(
    productBrands.map((brand) =>
      prisma.productBrand.upsert({
        where: { name: brand.name },
        update: brand,
        create: brand,
      }),
    ),
  );

  await Promise.all(
    seedCostCenters.map((costCenter) =>
      prisma.costCenter.upsert({
        where: { code: costCenter.code },
        update: costCenter,
        create: costCenter,
      }),
    ),
  );

  await Promise.all(
    seedWarehouses.map((warehouse) =>
      prisma.warehouse.upsert({
        where: { code: warehouse.code },
        update: warehouse,
        create: warehouse,
      }),
    ),
  );

  await Promise.all(
    taxes.map((tax) =>
      prisma.tax.upsert({
        where: { code: tax.code },
        update: tax,
        create: tax,
      }),
    ),
  );

  // --- Accounting Posting Engine (TASK-046) -----------------------------
  await Promise.all(
    postingChartOfAccounts.map((account) =>
      prisma.chartOfAccount.upsert({
        where: { code: account.code },
        update: account,
        create: account,
      }),
    ),
  );
  const accountsByCode = Object.fromEntries(
    (
      await prisma.chartOfAccount.findMany({
        where: { code: { in: postingChartOfAccounts.map((a) => a.code) } },
      })
    ).map((account) => [account.code, account.id]),
  );

  await prisma.tax.update({
    where: { code: 'VAT15' },
    data: {
      outputAccountId: accountsByCode.VATOUT,
      inputAccountId: accountsByCode.VATIN,
    },
  });

  const postingSettings = await prisma.postingSettings.findFirst();
  const postingSettingsData = {
    salesRevenueAccountId: accountsByCode.REV,
    costOfGoodsSoldAccountId: accountsByCode.COGS,
    inventoryAccountId: accountsByCode.INV,
    accountsReceivableAccountId: accountsByCode.AR,
    accountsPayableAccountId: accountsByCode.AP,
    defaultExpenseAccountId: accountsByCode.EXP,
    // TASK-047 — completes the Accounting Settings surface; Inventory
    // Adjustment defaults to COGS (TASK-046's own prior behavior) and
    // Purchase Account defaults to the same General Expense account as
    // Default Expense, so existing confirm() flows keep resolving to the
    // same accounts they did before this task.
    inventoryAdjustmentAccountId: accountsByCode.COGS,
    purchaseAccountId: accountsByCode.EXP,
    vatOutputAccountId: accountsByCode.VATOUT,
    vatInputAccountId: accountsByCode.VATIN,
    cashAccountId: accountsByCode.CASH,
  };
  if (postingSettings) {
    await prisma.postingSettings.update({
      where: { id: postingSettings.id },
      data: postingSettingsData,
    });
  } else {
    await prisma.postingSettings.create({ data: postingSettingsData });
  }

  await prisma.receivingAccount.upsert({
    where: { code: 'CASH-01' },
    update: { chartOfAccountId: accountsByCode.CASH },
    create: {
      code: 'CASH-01',
      name: 'الصندوق الرئيسي',
      chartOfAccountId: accountsByCode.CASH,
    },
  });

  // --- Journals (TASK-053) — the 5 standard books of entry, configuration
  // only. This seed data's Chart of Accounts has one combined "Cash / Bank"
  // account (no separate Bank code), so Cash and Bank Journal both default
  // to it; General Journal intentionally has no forced default accounts.
  const journals = [
    {
      code: 'SJ',
      name: 'Sales Journal',
      type: JournalType.SALES,
      sequencePrefix: 'SJ',
      defaultDebitAccountId: accountsByCode.AR,
      defaultCreditAccountId: accountsByCode.REV,
    },
    {
      code: 'PJ',
      name: 'Purchase Journal',
      type: JournalType.PURCHASE,
      sequencePrefix: 'PJ',
      defaultDebitAccountId: accountsByCode.EXP,
      defaultCreditAccountId: accountsByCode.AP,
    },
    {
      code: 'CSH',
      name: 'Cash Journal',
      type: JournalType.CASH,
      sequencePrefix: 'CSH',
      defaultDebitAccountId: accountsByCode.CASH,
      defaultCreditAccountId: accountsByCode.CASH,
    },
    {
      code: 'BNK',
      name: 'Bank Journal',
      type: JournalType.BANK,
      sequencePrefix: 'BNK',
      defaultDebitAccountId: accountsByCode.CASH,
      defaultCreditAccountId: accountsByCode.CASH,
    },
    {
      code: 'GJ',
      name: 'General Journal',
      type: JournalType.GENERAL,
      sequencePrefix: 'GJ',
    },
  ];
  await Promise.all(
    journals.map((journal) =>
      prisma.journal.upsert({
        where: { code: journal.code },
        update: journal,
        create: journal,
      }),
    ),
  );

  await Promise.all(
    customerGroups.map((group) =>
      prisma.customerGroup.upsert({
        where: { code: group.code },
        update: group,
        create: group,
      }),
    ),
  );

  await Promise.all(
    supplierGroups.map((group) =>
      prisma.supplierGroup.upsert({
        where: { code: group.code },
        update: group,
        create: group,
      }),
    ),
  );

  await Promise.all(
    languages.map((language) =>
      prisma.language.upsert({
        where: { code: language.code },
        update: language,
        create: language,
      }),
    ),
  );

  const countryByCode = new Map<string, { id: string }>();
  for (const country of countries) {
    const record = await prisma.country.findUniqueOrThrow({
      where: { code: country.code },
    });
    countryByCode.set(country.code, record);
  }
  await Promise.all(
    cities.map((city) => {
      const country = countryByCode.get(city.countryCode)!;
      return prisma.city.upsert({
        where: { countryId_code: { countryId: country.id, code: city.code } },
        update: { name: city.name },
        create: { countryId: country.id, code: city.code, name: city.name },
      });
    }),
  );

  // --- Auth + Company Context foundation (ADR-0022) -------------------------
  const companyByCode = new Map<string, { id: string }>();
  for (const company of companies) {
    const created = await prisma.company.upsert({
      where: { code: company.code },
      update: {},
      create: company,
    });
    companyByCode.set(company.code, created);
  }

  const branchByCode = new Map<string, { id: string }>();
  for (const branch of branches) {
    const company = companyByCode.get(branch.companyCode)!;
    const created = await prisma.branch.upsert({
      where: { companyId_code: { companyId: company.id, code: branch.code } },
      update: {},
      create: { companyId: company.id, name: branch.name, code: branch.code },
    });
    branchByCode.set(`${branch.companyCode}:${branch.code}`, created);
  }

  const permissionByName = new Map<string, { id: string }>();
  for (const name of modulePermissions) {
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: {
        name,
        description: `Access to the ${name.split('.')[0]} module`,
      },
    });
    permissionByName.set(name, created);
  }
  for (const name of masterDataPermissions) {
    const [, entity, action] = name.split('.');
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: {
        name,
        description: `${action} access to Master Data: ${entity}`,
      },
    });
    permissionByName.set(name, created);
  }
  for (const name of settingsPermissions) {
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: {
        name,
        description: 'Create, edit, enable/disable, and reset Number Series',
      },
    });
    permissionByName.set(name, created);
  }
  for (const name of accountingPeriodPermissions) {
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: {
        name,
        description:
          'Create Fiscal Years and Open/Close/Lock Accounting Periods',
      },
    });
    permissionByName.set(name, created);
  }
  for (const name of productPermissions) {
    const [, action] = name.split('.');
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name, description: `${action} access to Products` },
    });
    permissionByName.set(name, created);
  }
  for (const name of inventoryPermissions) {
    const [, entity, action] = name.split('.');
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name, description: `${action} access to Inventory ${entity}` },
    });
    permissionByName.set(name, created);
  }
  for (const name of salesQuotationPermissions) {
    const action = name.split('.')[2];
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name, description: `${action} access to Sales Quotations` },
    });
    permissionByName.set(name, created);
  }
  for (const name of salesOrderPermissions) {
    const action = name.split('.')[2];
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name, description: `${action} access to Sales Orders` },
    });
    permissionByName.set(name, created);
  }
  for (const name of salesInvoicePermissions) {
    const action = name.split('.')[2];
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name, description: `${action} access to Sales Invoices` },
    });
    permissionByName.set(name, created);
  }
  for (const name of salesReturnPermissions) {
    const action = name.split('.')[2];
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name, description: `${action} access to Sales Returns` },
    });
    permissionByName.set(name, created);
  }
  for (const name of purchasingQuotationPermissions) {
    const action = name.split('.')[2];
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name, description: `${action} access to Purchase Quotations` },
    });
    permissionByName.set(name, created);
  }
  for (const name of purchasingOrderPermissions) {
    const action = name.split('.')[2];
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name, description: `${action} access to Purchase Orders` },
    });
    permissionByName.set(name, created);
  }
  for (const name of purchasingInvoicePermissions) {
    const action = name.split('.')[2];
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name, description: `${action} access to Purchase Invoices` },
    });
    permissionByName.set(name, created);
  }
  for (const name of purchasingReturnPermissions) {
    const action = name.split('.')[2];
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name, description: `${action} access to Purchase Returns` },
    });
    permissionByName.set(name, created);
  }
  for (const name of purchasingPaymentPermissions) {
    const action = name.split('.')[2];
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: {
        name,
        description: `${action} access to Supplier Payment Vouchers`,
      },
    });
    permissionByName.set(name, created);
  }
  for (const name of salesReceiptPermissions) {
    const action = name.split('.')[2];
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: {
        name,
        description: `${action} access to Customer Receipt Vouchers`,
      },
    });
    permissionByName.set(name, created);
  }
  for (const name of journalEntryPermissions) {
    const action = name.split('.')[2];
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: {
        name,
        description: `${action} access to Manual Journal Entries`,
      },
    });
    permissionByName.set(name, created);
  }
  for (const name of importCenterPermissions) {
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: {
        name,
        description:
          'Create, upload, map, run, and cancel Import Jobs in the Import Center',
      },
    });
    permissionByName.set(name, created);
  }
  // TASK-060 — Permission Matrix catalog. Most of these names already exist
  // from the arrays above (`sales.invoices.confirm`, `products.archive`,
  // ...) and upsert to the same row; only the matrix's own additions
  // (`.view` per module, `accounting.chart-of-accounts.*`, `reports.*`,
  // `settings.manage`, ...) create new rows here.
  for (const name of ALL_PERMISSION_NAMES) {
    if (permissionByName.has(name)) continue;
    const created = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name, description: `Permission Matrix: ${name}` },
    });
    permissionByName.set(name, created);
  }

  // TASK-060 Part 2 — the closed Job Title label list.
  const jobTitleByName = new Map<string, { id: string }>();
  for (const name of jobTitles) {
    const created = await prisma.jobTitle.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    jobTitleByName.set(name, created);
  }

  const passwordHash = await bcrypt.hash('Passw0rd!', 10);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@oms.local' },
    update: {
      username: 'admin',
      jobTitleId: jobTitleByName.get('مدير النظام')!.id,
    },
    create: {
      email: 'admin@oms.local',
      username: 'admin',
      fullName: 'Sara Al-Amin',
      passwordHash,
      jobTitleId: jobTitleByName.get('مدير النظام')!.id,
    },
  });
  const salesUser = await prisma.user.upsert({
    where: { email: 'sales@oms.local' },
    update: {
      username: 'sales',
      jobTitleId: jobTitleByName.get('مدير المبيعات')!.id,
    },
    create: {
      email: 'sales@oms.local',
      username: 'sales',
      fullName: 'Omar Nasser',
      passwordHash,
      jobTitleId: jobTitleByName.get('مدير المبيعات')!.id,
    },
  });

  // TASK-060 — "Permissions are assigned directly to each user" (no
  // Role/RBAC layer). Admin gets every permission ever seeded (every module
  // + every granular action permission); Sales Agent keeps the same
  // narrower CRM/Sales/Products-only set the old "Sales Agent" Role used to
  // model — create/edit/submit on every Sales document but never
  // approve/confirm/cancel/archive (self-approval), matching a real sales
  // rep's actual authority.
  for (const name of permissionByName.keys()) {
    const permission = permissionByName.get(name)!;
    await prisma.userPermission.upsert({
      where: {
        userId_permissionId: {
          userId: adminUser.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: { userId: adminUser.id, permissionId: permission.id },
    });
  }
  for (const name of [
    'crm.view',
    'sales.view',
    'products.view',
    'products.create',
    'products.edit',
    'sales.customers.view',
    'sales.customers.create',
    'sales.customers.edit',
    'sales.quotations.view',
    'sales.quotations.create',
    'sales.quotations.edit',
    'sales.orders.view',
    'sales.orders.create',
    'sales.orders.edit',
    'sales.invoices.view',
    'sales.invoices.create',
    'sales.invoices.edit',
    'sales.returns.view',
    'sales.returns.create',
    'sales.returns.edit',
  ]) {
    const permission = permissionByName.get(name);
    if (!permission) continue;
    await prisma.userPermission.upsert({
      where: {
        userId_permissionId: {
          userId: salesUser.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: { userId: salesUser.id, permissionId: permission.id },
    });
  }

  const acme = companyByCode.get('ACME')!;
  const nova = companyByCode.get('NOVA')!;
  const acmeMain = branchByCode.get('ACME:MAIN')!;

  // Admin belongs to both companies (demonstrates the Company Switcher).
  await prisma.companyMembership.upsert({
    where: { userId_companyId: { userId: adminUser.id, companyId: acme.id } },
    update: {},
    create: { userId: adminUser.id, companyId: acme.id, branchId: acmeMain.id },
  });
  await prisma.companyMembership.upsert({
    where: { userId_companyId: { userId: adminUser.id, companyId: nova.id } },
    update: {},
    create: { userId: adminUser.id, companyId: nova.id },
  });
  // Sales agent belongs to one company only.
  await prisma.companyMembership.upsert({
    where: { userId_companyId: { userId: salesUser.id, companyId: acme.id } },
    update: {},
    create: { userId: salesUser.id, companyId: acme.id, branchId: acmeMain.id },
  });

  // ---------------------------------------------------------------------
  // Analytic Accounting demo data (TASK-026 Part 2) — Odoo-style: one flat
  // plan per dimension, unlimited-hierarchy accounts underneath. مشروع
  // الرياض carries two child phases to demonstrate the hierarchy actually
  // works, not just that the FK exists.
  // ---------------------------------------------------------------------
  const analyticPlansData = [
    {
      code: 'PROJECTS',
      name: 'المشاريع',
      description: 'تحليل الربحية حسب المشروع',
      displayOrder: 1,
    },
    {
      code: 'DEPARTMENTS',
      name: 'الإدارات',
      description: 'تحليل التكاليف حسب الإدارة',
      displayOrder: 2,
    },
    {
      code: 'BRANCHES_PLAN',
      name: 'الفروع',
      description: 'تحليل الأداء حسب الفرع',
      displayOrder: 3,
    },
    {
      code: 'CAMPAIGNS',
      name: 'الحملات التسويقية',
      description: 'تحليل تكلفة وعائد الحملات التسويقية',
      displayOrder: 4,
    },
    {
      code: 'VEHICLES',
      name: 'السيارات',
      description: 'تحليل تكاليف تشغيل المركبات',
      displayOrder: 5,
    },
    {
      code: 'SALES_REPS',
      name: 'المناديب',
      description: 'تحليل أداء مناديب المبيعات',
      displayOrder: 6,
    },
  ];

  const analyticPlanByCode = new Map<string, { id: string }>();
  for (const plan of analyticPlansData) {
    const created = await prisma.analyticPlan.upsert({
      where: { code: plan.code },
      update: {
        name: plan.name,
        description: plan.description,
        displayOrder: plan.displayOrder,
        updatedBy: adminUser.id,
      },
      create: { ...plan, createdBy: adminUser.id, updatedBy: adminUser.id },
    });
    analyticPlanByCode.set(plan.code, created);
  }

  const analyticAccountsData: {
    code: string;
    name: string;
    planCode: string;
    parentCode?: string;
    notes?: string;
  }[] = [
    // المشاريع
    {
      code: 'PRJ-RUH',
      name: 'مشروع الرياض',
      planCode: 'PROJECTS',
      notes: 'مشروع تنفيذ الرياض',
    },
    {
      code: 'PRJ-RUH-P1',
      name: 'المرحلة الأولى',
      planCode: 'PROJECTS',
      parentCode: 'PRJ-RUH',
    },
    {
      code: 'PRJ-RUH-P2',
      name: 'المرحلة الثانية',
      planCode: 'PROJECTS',
      parentCode: 'PRJ-RUH',
    },
    { code: 'PRJ-JED', name: 'مشروع جدة', planCode: 'PROJECTS' },
    { code: 'PRJ-DMM', name: 'مشروع الدمام', planCode: 'PROJECTS' },
    // الإدارات
    { code: 'DEPT-FIN', name: 'الإدارة المالية', planCode: 'DEPARTMENTS' },
    { code: 'DEPT-SALES', name: 'إدارة المبيعات', planCode: 'DEPARTMENTS' },
    { code: 'DEPT-HR', name: 'إدارة الموارد البشرية', planCode: 'DEPARTMENTS' },
    // الفروع
    { code: 'BR-MAIN', name: 'الفرع الرئيسي', planCode: 'BRANCHES_PLAN' },
    { code: 'BR-JED', name: 'فرع جدة', planCode: 'BRANCHES_PLAN' },
    { code: 'BR-DMM', name: 'فرع الدمام', planCode: 'BRANCHES_PLAN' },
    // الحملات التسويقية
    { code: 'CMP-GADS', name: 'Google Ads', planCode: 'CAMPAIGNS' },
    { code: 'CMP-META', name: 'Meta Ads', planCode: 'CAMPAIGNS' },
    { code: 'CMP-EMAIL', name: 'Email Marketing', planCode: 'CAMPAIGNS' },
    // السيارات
    { code: 'VEH-DEL1', name: 'مركبة التوصيل 1', planCode: 'VEHICLES' },
    { code: 'VEH-DEL2', name: 'مركبة التوصيل 2', planCode: 'VEHICLES' },
    { code: 'VEH-SALES', name: 'سيارة المبيعات', planCode: 'VEHICLES' },
    // المناديب
    { code: 'REP-RUH', name: 'مندوب الرياض', planCode: 'SALES_REPS' },
    { code: 'REP-JED', name: 'مندوب جدة', planCode: 'SALES_REPS' },
    { code: 'REP-DMM', name: 'مندوب الدمام', planCode: 'SALES_REPS' },
  ];

  const analyticAccountByCode = new Map<string, { id: string }>();
  for (const account of analyticAccountsData) {
    const plan = analyticPlanByCode.get(account.planCode)!;
    const parent = account.parentCode
      ? analyticAccountByCode.get(account.parentCode)
      : undefined;
    const created = await prisma.analyticAccount.upsert({
      where: { code: account.code },
      update: {
        name: account.name,
        analyticPlanId: plan.id,
        parentAccountId: parent?.id ?? null,
        notes: account.notes ?? null,
        updatedBy: adminUser.id,
      },
      create: {
        code: account.code,
        name: account.name,
        analyticPlanId: plan.id,
        parentAccountId: parent?.id ?? null,
        notes: account.notes ?? null,
        createdBy: adminUser.id,
        updatedBy: adminUser.id,
      },
    });
    analyticAccountByCode.set(account.code, created);
  }

  // ---------------------------------------------------------------------
  // Number Series demo data (TASK-026 Part 2) — the 6 marked `real` are the
  // exact `documentType` strings the codebase already calls
  // `generateNumber()` with (Suppliers/Leads/Sales Orders/Payments/Purchase
  // Orders/Inventory Movements); the rest are prepared-only rows for
  // document types no module generates yet. `nextNumber` is intentionally
  // ONLY set on `create` — re-running the seed must never rewind a series
  // that has already issued real numbers.
  // ---------------------------------------------------------------------
  const numberSeriesData: {
    documentType: string;
    label: string;
    docCode: string;
    template: string;
    padding?: number;
    yearReset?: boolean;
    monthReset?: boolean;
    dayReset?: boolean;
  }[] = [
    {
      documentType: 'SUPPLIER',
      label: 'Supplier',
      docCode: 'SUP',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      documentType: 'LEAD',
      label: 'Lead',
      docCode: 'LD',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      documentType: 'SALES_ORDER',
      label: 'Sales Order',
      docCode: 'SO',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      documentType: 'PAYMENT',
      label: 'Payment',
      docCode: 'PAY',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      documentType: 'PURCHASE_ORDER',
      label: 'Purchase Order',
      docCode: 'PO',
      template: '{BRANCH}-{DOC}-{YEAR}-{SEQ}',
    },
    {
      documentType: 'INVENTORY_MOVEMENT',
      label: 'Inventory Movement',
      docCode: 'MV',
      template: '{DOC}/{MONTH}/{YEAR}/{SEQ}',
      monthReset: true,
      yearReset: false,
    },
    {
      // TASK-029 — Opening Inventory now gets its own document series
      // (previously shared the generic INVENTORY_MOVEMENT/MV series).
      documentType: 'OPENING_INVENTORY',
      label: 'Opening Inventory',
      docCode: 'OPN',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      // TASK-029 — Inventory Adjustment now gets its own document series.
      documentType: 'INVENTORY_ADJUSTMENT',
      label: 'Inventory Adjustment',
      docCode: 'ADJ',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      // TASK-037 (Sales Foundation) — this was a prepared-only row from an
      // earlier task (never consumed by any module); docCode updated from
      // 'SI' to 'INV' so SalesInvoicesService's real numbers now render as
      // the task's specified "INV-2026-000001", not the old placeholder
      // prefix.
      documentType: 'SALES_INVOICE',
      label: 'Sales Invoice',
      docCode: 'INV',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      // TASK-037 — the new B2B Sales Order document. Deliberately NOT the
      // 'SALES_ORDER' key above (that one is already owned by the
      // unrelated Leads->Shipping SalesOrder module) — see the schema
      // comment on the SalesOrderDocument model. Same docCode 'SO' as that
      // other series is intentional and safe (documentType, not docCode,
      // is the unique key): the printed number for both looks like
      // "SO-2026-000001" from two independent counters, which is exactly
      // what was approved for this task.
      documentType: 'SALES_ORDER_DOC',
      label: 'Sales Order',
      docCode: 'SO',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      // TASK-037 — Sales Return had no prepared row yet.
      documentType: 'SALES_RETURN',
      label: 'Sales Return',
      docCode: 'SR',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      documentType: 'PURCHASE_INVOICE',
      label: 'Purchase Invoice',
      docCode: 'PI',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      // TASK-043 — distinct from the pre-existing generic 'RECEIPT'/'PAYMENT'
      // rows (the latter already claimed by the COD PaymentsService) —
      // same "don't collide with a differently-scoped existing key"
      // reasoning as SALES_ORDER_DOC vs SALES_ORDER.
      documentType: 'CUSTOMER_RECEIPT',
      label: 'Customer Receipt',
      docCode: 'CR',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      documentType: 'SUPPLIER_PAYMENT',
      label: 'Supplier Payment',
      docCode: 'SP',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      // TASK-048 — Purchase Quotation had no prepared row yet.
      documentType: 'PURCHASE_QUOTATION',
      label: 'Purchase Quotation',
      docCode: 'PQ',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      // TASK-048 — Purchase Return had no prepared row yet.
      documentType: 'PURCHASE_RETURN',
      label: 'Purchase Return',
      docCode: 'PR',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      // TASK-037 — was prepared-only; now consumed by SalesQuotationsService.
      documentType: 'QUOTATION',
      label: 'Quotation',
      docCode: 'QT',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      documentType: 'EXPENSE',
      label: 'Expense',
      docCode: 'EXP',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      documentType: 'JOURNAL_ENTRY',
      label: 'Journal Entry',
      docCode: 'JV',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      documentType: 'RECEIPT',
      label: 'Receipt',
      docCode: 'RCP',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      documentType: 'OPPORTUNITY',
      label: 'Opportunity',
      docCode: 'OPP',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      // TASK-037 — was prepared-only; now consumed by CustomersService.
      documentType: 'CUSTOMER',
      label: 'Customer',
      docCode: 'CUS',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      documentType: 'PRODUCT',
      label: 'Product',
      docCode: 'PRD',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      // TASK-029 — Stock Transfer now actually generates numbers from this
      // series (previously prepared-only); docCode/template updated to the
      // spec's plain "TRF-2026-000001" shape.
      documentType: 'WAREHOUSE_TRANSFER',
      label: 'Warehouse Transfer',
      docCode: 'TRF',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      documentType: 'WAREHOUSE',
      label: 'Warehouse',
      docCode: 'WH',
      template: '{DOC}-{SEQ}',
    },
    {
      documentType: 'WAREHOUSE_LOCATION',
      label: 'Warehouse Location',
      docCode: 'LOC',
      template: '{DOC}-{SEQ}',
    },
    {
      documentType: 'PAYMENT_TERM',
      label: 'Payment Term',
      docCode: 'PT',
      template: '{DOC}-{SEQ}',
    },
    {
      // TASK-029 — Physical Count now actually generates numbers from this
      // series (previously prepared-only); docCode/template updated to the
      // spec's plain "CNT-2026-000001" shape.
      documentType: 'INVENTORY_COUNT',
      label: 'Inventory Count',
      docCode: 'CNT',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      documentType: 'EMPLOYEE',
      label: 'Employee',
      docCode: 'EMP',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      documentType: 'ASSET',
      label: 'Asset',
      docCode: 'AST',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
  ];

  for (const series of numberSeriesData) {
    const padding = series.padding ?? 6;
    const yearReset = series.yearReset ?? true;
    const monthReset = series.monthReset ?? false;
    const dayReset = series.dayReset ?? false;
    await prisma.numberSeries.upsert({
      where: { documentType: series.documentType },
      update: {
        label: series.label,
        docCode: series.docCode,
        template: series.template,
        padding,
        yearReset,
        monthReset,
        dayReset,
        updatedBy: adminUser.id,
      },
      create: {
        documentType: series.documentType,
        label: series.label,
        docCode: series.docCode,
        template: series.template,
        padding,
        yearReset,
        monthReset,
        dayReset,
        nextNumber: 1,
        active: true,
        createdBy: adminUser.id,
        updatedBy: adminUser.id,
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
