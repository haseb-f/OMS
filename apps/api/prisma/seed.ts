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
import { INITIAL_SHIPPING_STATUSES } from '../src/shipping/shipping-status.catalog';
import { INITIAL_WORKFLOW_STATUSES } from '../src/workflow/workflow.catalog';
import { SYSTEM_TRANSACTION_TYPES } from '../src/transaction-types/transaction-type.catalog';
import { seedCountries } from './scripts/seed-countries';

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
  'payment-terms',
  'shipping-companies',
  'shipping-statuses',
  'workflow-statuses',
  'customer-groups',
  'supplier-groups',
  'countries',
  'cities',
  'languages',
  'warehouse-locations',
  'unit-conversions',
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
  // Transaction Types Registry (Cash Transactions Foundation).
  'transaction-types',
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

// Default seeded Job Titles (Master Data — see 20260906120000_job_titles_master_data).
// Labels only; `code` is never joined into a permission check anywhere in
// this codebase. An admin can create further custom titles at runtime —
// this is just the starting set.
const jobTitles = [
  { name: 'مدير النظام', nameEn: 'System Administrator', code: 'SYSTEM_ADMIN' },
  { name: 'المدير العام', nameEn: 'General Manager', code: 'GENERAL_MANAGER' },
  { name: 'المدير المالي', nameEn: 'Finance Manager', code: 'FINANCE_MANAGER' },
  { name: 'المحاسب', nameEn: 'Accountant', code: 'ACCOUNTANT' },
  { name: 'مدير المبيعات', nameEn: 'Sales Manager', code: 'SALES_MANAGER' },
  {
    name: 'مدير التشغيل',
    nameEn: 'Operations Manager',
    code: 'OPERATIONS_MANAGER',
  },
  {
    name: 'موظف خدمة العملاء',
    nameEn: 'Customer Service Representative',
    code: 'CUSTOMER_SERVICE',
  },
  { name: 'موظف الشحن', nameEn: 'Shipping Staff', code: 'SHIPPING_STAFF' },
  {
    name: 'أخصائي الموارد البشرية',
    nameEn: 'HR Specialist',
    code: 'HR_SPECIALIST',
  },
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
  // 2026-08-16 root-cause fix: the formal/official Arabic name caused every
  // real-world import (spreadsheets, Google Sheets) that naturally uses the
  // common short name to be rejected as "not a recognized Country" — a
  // fragile-display-name problem, not a missing-country problem. Corrected
  // to match `i18n-iso-countries`' own Arabic translation for 'SA'
  // (verified identical to what the curated EG/AE rows already use) —
  // restoring the general library-driven convention rather than
  // special-casing the import logic.
  { code: 'SA', name: 'السعودية' },
  { code: 'EG', name: 'مصر' },
  { code: 'AE', name: 'الإمارات العربية المتحدة' },
];

// Shipping Companies only — Shipping Methods retired (type lives on company).
const shippingCompanies = [
  { name: 'توصيل داخلي', type: ShippingMethodType.INTERNAL_DELIVERY },
  { name: 'SMSA', type: ShippingMethodType.EXTERNAL_COMPANY },
  { name: 'Aramex', type: ShippingMethodType.EXTERNAL_COMPANY },
  { name: 'DHL', type: ShippingMethodType.EXTERNAL_COMPANY },
  { name: 'FedEx', type: ShippingMethodType.EXTERNAL_COMPANY },
];

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
  // Investor Engine Milestone 3 — Investor Accounting Settings defaults.
  // Legal/economic classification is a real accounting decision left to
  // whoever configures these in a real deployment; LIABILITY is the
  // reasonable neutral default for a seeded demo environment.
  {
    code: 'INVFUND',
    name: 'Investor Funding',
    accountType: AccountType.LIABILITY,
  },
  {
    code: 'INVDIST',
    name: 'Investor Profit Distribution',
    accountType: AccountType.EXPENSE,
  },
  {
    code: 'INVPAY',
    name: 'Investor Profit Payable',
    accountType: AccountType.LIABILITY,
  },
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

  // Curated Arabic names for the 3 countries the business actually operates
  // in — seeded first so `seedCountries()` below (Part 2: full ISO 3166-1
  // dataset) finds `name` already set and never overwrites it with the
  // library's more literal Arabic translation.
  await Promise.all(
    countries.map((country) =>
      prisma.country.upsert({
        where: { code: country.code },
        update: country,
        create: country,
      }),
    ),
  );
  const countrySeedResult = await seedCountries(prisma);
  console.log(
    `Countries: ${countrySeedResult.created} created, ${countrySeedResult.updated} updated, ${countrySeedResult.skipped} skipped (of ${countrySeedResult.total} ISO 3166-1 regions).`,
  );

  // Wires `Country.defaultCurrencyId` (Part 1/3 — "Currency should be
  // auto-derived from country... not manually typed") for every
  // country/currency pair this system actually has both rows for — never a
  // fabricated pairing for a currency this system doesn't seed.
  const defaultCurrencyByCountryCode: Record<string, string> = {
    SA: 'SAR',
    AE: 'AED',
    EG: 'EGP',
    US: 'USD',
  };
  for (const [countryCode, currencyCode] of Object.entries(
    defaultCurrencyByCountryCode,
  )) {
    const currency = await prisma.currency.findUnique({
      where: { code: currencyCode },
    });
    if (!currency) continue;
    await prisma.country.update({
      where: { code: countryCode },
      data: { defaultCurrencyId: currency.id },
    });
  }

  await Promise.all(
    shippingCompanies.map((company) =>
      prisma.shippingCompany.upsert({
        where: { name: company.name },
        update: { type: company.type },
        create: company,
      }),
    ),
  );

  // Soft-archive any leftover ShippingMethod rows (table kept for rollback).
  await prisma.shippingMethod.updateMany({
    where: { deletedAt: null },
    data: { deletedAt: new Date() },
  });

  await Promise.all(
    INITIAL_SHIPPING_STATUSES.map((status) =>
      prisma.shippingStatus.upsert({
        where: { code: status.code },
        update: {
          isSystem: status.isSystem,
          isDefault: status.isDefault,
          isImportable: status.isImportable,
          sortOrder: status.sortOrder,
        },
        create: {
          code: status.code,
          name: status.name,
          color: status.color,
          isSystem: status.isSystem,
          isDefault: status.isDefault,
          isImportable: status.isImportable,
          sortOrder: status.sortOrder,
          syncBehavior: status.syncBehavior,
        },
      }),
    ),
  );

  await Promise.all(
    INITIAL_WORKFLOW_STATUSES.map((status) =>
      prisma.statusDefinition.upsert({
        where: {
          workflowType_code: {
            workflowType: status.workflowType,
            code: status.code,
          },
        },
        update: {
          isSystem: status.isSystem,
          isDefault: status.isDefault,
          isFinal: status.isFinal,
          sortOrder: status.sortOrder,
        },
        create: {
          workflowType: status.workflowType,
          code: status.code,
          name: status.name,
          nameEn: status.nameEn,
          color: status.color,
          isSystem: status.isSystem,
          isDefault: status.isDefault,
          isFinal: status.isFinal,
          sortOrder: status.sortOrder,
        },
      }),
    ),
  );

  // Transaction Types Registry (Cash Transactions Foundation) — idempotent
  // upsert by `code`, same dual seed-migration+seed.ts pattern as
  // INITIAL_SHIPPING_STATUSES above (the migration already inserts these
  // once for production; this keeps local/dev re-seeding safe).
  await Promise.all(
    SYSTEM_TRANSACTION_TYPES.map((type) =>
      prisma.transactionType.upsert({
        where: { code: type.code },
        update: {
          nameAr: type.nameAr,
          nameEn: type.nameEn,
          direction: type.direction,
          nature: type.nature,
          matchingTarget: type.matchingTarget,
          defaultAccountingTreatment: type.defaultAccountingTreatment,
          sortOrder: type.sortOrder,
          isSystem: true,
        },
        create: {
          code: type.code,
          nameAr: type.nameAr,
          nameEn: type.nameEn,
          direction: type.direction,
          nature: type.nature,
          matchingTarget: type.matchingTarget,
          defaultAccountingTreatment: type.defaultAccountingTreatment,
          sortOrder: type.sortOrder,
          isSystem: true,
        },
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

  // --- Chart of Accounts: five protected roots, then operational leaves ---
  const systemRoots = [
    { code: '1', name: 'الأصول', accountType: AccountType.ASSET },
    { code: '2', name: 'الالتزامات', accountType: AccountType.LIABILITY },
    { code: '3', name: 'حقوق الملكية', accountType: AccountType.EQUITY },
    { code: '4', name: 'الإيرادات', accountType: AccountType.REVENUE },
    { code: '5', name: 'المصروفات', accountType: AccountType.EXPENSE },
  ];
  await Promise.all(
    systemRoots.map((root) =>
      prisma.chartOfAccount.upsert({
        where: { code: root.code },
        update: {
          name: root.name,
          accountType: root.accountType,
          parentAccountId: null,
          level: 1,
          allowsPosting: false,
          isSystemAccount: true,
        },
        create: {
          ...root,
          parentAccountId: null,
          level: 1,
          allowsPosting: false,
          isSystemAccount: true,
        },
      }),
    ),
  );
  const rootsByType = Object.fromEntries(
    (
      await prisma.chartOfAccount.findMany({
        where: { code: { in: systemRoots.map((r) => r.code) } },
      })
    ).map((root) => [root.accountType, root.id]),
  );

  await Promise.all(
    postingChartOfAccounts.map((account) =>
      prisma.chartOfAccount.upsert({
        where: { code: account.code },
        update: {
          name: account.name,
          accountType: account.accountType,
          parentAccountId: rootsByType[account.accountType],
          level: 2,
          allowsPosting: true,
          isSystemAccount: false,
        },
        create: {
          ...account,
          parentAccountId: rootsByType[account.accountType],
          level: 2,
          allowsPosting: true,
          isSystemAccount: false,
        },
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
    // Investor Engine Milestone 3 — capitalReturnAccountId is deliberately
    // left unconfigured here so it exercises its documented fallback to
    // investorFundingAccountId (AccountMappingService.resolveCapitalReturnAccount).
    investorFundingAccountId: accountsByCode.INVFUND,
    investorProfitDistributionAccountId: accountsByCode.INVDIST,
    investorProfitPayableAccountId: accountsByCode.INVPAY,
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

  // Default seeded Job Titles — Master Data (see 20260906120000_job_titles_master_data).
  const jobTitleByName = new Map<string, { id: string }>();
  for (const title of jobTitles) {
    const created = await prisma.jobTitle.upsert({
      where: { name: title.name },
      update: {},
      create: title,
    });
    jobTitleByName.set(title.name, created);
  }

  const passwordHash = await bcrypt.hash('Passw0rd!', 10);

  // Sales Department + Team — needed so the seeded Sales Manager test
  // persona actually resolves to SalesScopeService's TEAM scope (managing a
  // SalesTeam), not just holding a permission string. Required FK for
  // SalesTeam; a generic "Sales" department is safe, universal test setup,
  // not business-specific taxonomy.
  const salesDepartment = await prisma.department.upsert({
    where: { code: 'DEPT-SALES' },
    update: {},
    create: { code: 'DEPT-SALES', name: 'المبيعات', nameEn: 'Sales' },
  });

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
  // Second Sales Agent test persona — needed to verify cross-agent Lead
  // isolation (Agent A must never see Agent B's Leads). Same permission
  // shape as `salesUser`.
  const salesUserB = await prisma.user.upsert({
    where: { email: 'sales2@oms.local' },
    update: {
      username: 'sales2',
      jobTitleId: jobTitleByName.get('مدير المبيعات')!.id,
    },
    create: {
      email: 'sales2@oms.local',
      username: 'sales2',
      fullName: 'Yousef Hamdan',
      passwordHash,
      jobTitleId: jobTitleByName.get('مدير المبيعات')!.id,
    },
  });
  // Sales Manager test persona — a real TEAM-scope manager (below), not just
  // a permission string, so Assign/Distribute/team-visibility can be
  // verified against SalesScopeService's actual TEAM branch.
  const salesManagerUser = await prisma.user.upsert({
    where: { email: 'sales-manager@oms.local' },
    update: {
      username: 'sales-manager',
      jobTitleId: jobTitleByName.get('مدير المبيعات')!.id,
    },
    create: {
      email: 'sales-manager@oms.local',
      username: 'sales-manager',
      fullName: 'Laila Qahtani',
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
  const salesAgentPermissionNames = [
    'crm.view',
    'sales.view',
    'products.view',
    'products.create',
    'products.edit',
    // Was 'sales.customers.*' — a permission name that predates the Partner
    // module consolidation and no longer exists in permission-catalog.ts, so
    // this grant silently no-opped. `partners.create` is the real, current
    // gate on quick-creating a customer inline. Deliberately NOT
    // `partners.view`/`partners.edit` — those are full Partner/Supplier
    // *directory* management (and `partners.view` alone made the entire
    // "Purchasing" sidebar section visible, since Suppliers/Supplier Groups
    // share that same permission). A Sales Agent picks an existing customer
    // via PartnerPicker's /partners/catalog read (any document-creation
    // permission grants that), never the full directory.
    'partners.create',
    // A Sales Agent test persona needs the Lead -> Convert -> Store Order
    // path to actually be exercisable end-to-end.
    'crm.leads.view',
    'crm.leads.create',
    'crm.leads.edit',
    'crm.leads.convert',
    'store-orders.view',
    'store-orders.create',
    'store-orders.edit',
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
    // Leads/Customers/Orders Finalization Milestone — exact-match lookup
    // only, never `partners.view`/`store-orders.manage`'s full directory
    // browse; lets an Agent recognize a returning Customer or open another
    // Agent's Order read-only via the Global Lookup dialog.
    'customers.lookup_global',
    'orders.lookup_global',
  ];
  async function grantPermissions(userId: string, names: string[]) {
    for (const name of names) {
      const permission = permissionByName.get(name);
      if (!permission) continue;
      await prisma.userPermission.upsert({
        where: { userId_permissionId: { userId, permissionId: permission.id } },
        update: {},
        create: { userId, permissionId: permission.id },
      });
    }
  }
  // Agent A and Agent B: identical, deliberately narrow Sales Agent
  // authority — OWN-scope only, per SalesScopeService (no crm.leads.manage,
  // not a SalesTeam manager).
  await grantPermissions(salesUser.id, salesAgentPermissionNames);
  await grantPermissions(salesUserB.id, salesAgentPermissionNames);
  // Sales Manager: the same day-to-day Sales authority as an Agent, plus
  // crm.leads.manage (Distribute Leads) — TEAM scope itself comes from
  // managing the Sales Team below, not from a permission string.
  await grantPermissions(salesManagerUser.id, [
    ...salesAgentPermissionNames,
    'crm.leads.manage',
  ]);
  // Revoke over-grants from an earlier version of this seed — upsert only
  // ever adds, so removing a name from salesAgentPermissionNames above
  // leaves a stale row behind unless explicitly deleted here too.
  const revokedSalesAgentPermissionNames = ['partners.view', 'partners.edit'];
  for (const userId of [salesUser.id, salesUserB.id, salesManagerUser.id]) {
    const revokedIds = revokedSalesAgentPermissionNames
      .map((name) => permissionByName.get(name)?.id)
      .filter((id): id is string => !!id);
    if (revokedIds.length) {
      await prisma.userPermission.deleteMany({
        where: { userId, permissionId: { in: revokedIds } },
      });
    }
  }

  // Finance test personas — needed to verify the Confirm/Unreconcile
  // permission tier split: a Finance user can review and confirm
  // reconciliation but must NOT be able to undo one; only Finance
  // Manager/Admin holds `accounting.bank-transactions.unreconcile`.
  const financeUser = await prisma.user.upsert({
    where: { email: 'finance@oms.local' },
    update: {
      username: 'finance',
      jobTitleId: jobTitleByName.get('المحاسب')!.id,
    },
    create: {
      email: 'finance@oms.local',
      username: 'finance',
      fullName: 'Huda Al-Zahrani',
      passwordHash,
      jobTitleId: jobTitleByName.get('المحاسب')!.id,
    },
  });
  const financeManagerUser = await prisma.user.upsert({
    where: { email: 'finance-manager@oms.local' },
    update: {
      username: 'finance-manager',
      jobTitleId: jobTitleByName.get('المدير المالي')!.id,
    },
    create: {
      email: 'finance-manager@oms.local',
      username: 'finance-manager',
      fullName: 'Tariq Suleiman',
      passwordHash,
      jobTitleId: jobTitleByName.get('المدير المالي')!.id,
    },
  });
  const financeUserPermissionNames = [
    'finance.view',
    'accounting.bank-transactions.view',
    'accounting.bank-transactions.manage',
    // Read-only Chart of Accounts access — required by AccountPicker
    // wherever a Finance user must select an account while reconciling
    // (the bank-fee/settlement-difference account, an Expense Payment
    // Voucher's expense account). Live-verified missing: a Finance user
    // could open the "record a bank fee" toggle but the account search
    // silently 403'd, with no way to complete the net-receipt flow at all.
    'accounting.chart-of-accounts.view',
    'sales.receipts.view',
    'sales.receipts.create',
    'sales.receipts.edit',
    'sales.receipts.confirm',
    'purchasing.payments.view',
    'purchasing.payments.create',
    'purchasing.payments.edit',
    'purchasing.payments.confirm',
    'accounting.expense-payments.view',
    'accounting.expense-payments.create',
    'accounting.expense-payments.edit',
    'accounting.expense-payments.confirm',
    // TASK-062 Security Hardening — Finance-owned Master Data (previously
    // reachable by ANY authenticated user; now real CRUD authority is
    // scoped to Finance). Fiscal Years/Periods/Posting Settings/Year-Closing
    // stay Administrator-only, unchanged from their original design intent.
    'masterdata.cost-centers.view',
    'masterdata.cost-centers.create',
    'masterdata.cost-centers.edit',
    'masterdata.cost-centers.archive',
    'masterdata.currencies.view',
    'masterdata.currencies.create',
    'masterdata.currencies.edit',
    'masterdata.currencies.archive',
    'masterdata.taxes.view',
    'masterdata.taxes.create',
    'masterdata.taxes.edit',
    'masterdata.taxes.archive',
    'masterdata.payment-methods.view',
    'masterdata.payment-methods.create',
    'masterdata.payment-methods.edit',
    'masterdata.payment-methods.archive',
    'masterdata.payment-terms.view',
    'masterdata.payment-terms.create',
    'masterdata.payment-terms.edit',
    'masterdata.payment-terms.archive',
    'masterdata.analytic-accounts.view',
    'masterdata.analytic-accounts.create',
    'masterdata.analytic-accounts.edit',
    'masterdata.analytic-accounts.archive',
    'masterdata.analytic-plans.view',
    'masterdata.analytic-plans.create',
    'masterdata.analytic-plans.edit',
    'masterdata.analytic-plans.archive',
    'masterdata.analytic-distributions.view',
    'masterdata.analytic-distributions.edit',
    'masterdata.journals.view',
    'masterdata.journals.create',
    'masterdata.journals.edit',
    'masterdata.journals.archive',
    'masterdata.expenses.view',
    'masterdata.expenses.create',
    'masterdata.expenses.edit',
    'masterdata.expenses.archive',
    'masterdata.fixed-assets.view',
    'masterdata.fixed-assets.create',
    'masterdata.fixed-assets.edit',
    'masterdata.fixed-assets.archive',
    'masterdata.payment-sources.view',
    'masterdata.payment-sources.create',
    'masterdata.payment-sources.edit',
    'masterdata.payment-sources.archive',
    'masterdata.receiving-accounts.view',
    'masterdata.receiving-accounts.create',
    'masterdata.receiving-accounts.edit',
    'masterdata.receiving-accounts.archive',
    'expenses.view',
    // Investor Engine Milestone 1, Phase 19 — Finance reviews/confirms
    // funding but does not create/manage Opportunities themselves.
    'investors.view',
    'investment-opportunities.view',
    'investor-subscriptions.view',
    'capital-contributions.view',
    'capital-contributions.create',
    'capital-contributions.edit',
    'capital-contributions.confirm',
    // Investor Engine Milestone 2, Phase 49/50 — Finance operates the
    // Sales Allocation/Expenses/Profit/Settlement engines end to end (same
    // financial-ownership role M1 already gave Finance over funding).
    'investment-sales.view',
    'investment-sales.manage',
    'investment-sales.reallocate',
    'investment-expenses.view',
    'investment-expenses.create',
    'investment-expenses.edit',
    'investment-expenses.approve',
    'investment-profit.view',
    'investment-profit.calculate',
    'investment-profit.approve',
    'investment-settlement.view',
    'investment-settlement.start',
    'investment-settlement.manage',
    'investment-settlement.approve',
    'investment-settlement.cancel',
    // Investor Engine Milestone 3, Phase 49/51 — Finance runs the
    // Distribution/Payment/Capital Return workflows end to end, but the
    // Accounting mapping itself is configuration, not an operational
    // action — reserved for the Finance Manager persona below.
    'investment-distributions.view',
    'investment-distributions.create',
    'investment-distributions.approve',
    'investment-distributions.cancel',
    'investment-payments.view',
    'investment-payments.create',
    'investment-payments.confirm',
    'investment-payments.cancel',
    'investor-ledger.view',
    'capital-returns.view',
    'capital-returns.create',
    'capital-returns.approve',
    'capital-returns.pay',
    'capital-returns.cancel',
    'investment-accounting.view',
    // Investor Engine Milestone 4 — Finance can see Investor Settings/Portal
    // status but not change configuration (reserved for Finance Manager).
    'investor-settings.view',
    'investor-portal.view',
  ];
  await grantPermissions(financeUser.id, financeUserPermissionNames);
  await grantPermissions(financeManagerUser.id, [
    ...financeUserPermissionNames,
    'accounting.bank-transactions.unreconcile',
    // Phase 51 — only the Finance Manager persona can change Investor
    // Accounting mappings, never plain Finance.
    'investment-accounting.configure',
    'investor-ledger.adjust',
    // Investor Engine Milestone 4 — Investor Type Master Data + Portal
    // access administration (Invite/Suspend/Reactivate/Disable).
    'investor-settings.create',
    'investor-settings.edit',
    'investor-settings.archive',
    'investor-portal.manage',
    'investor-portal.invite',
  ]);

  // Shipping Agent test persona — the Orders/Shipping quick-edit
  // (Shipping Status/Carrier/Tracking Number/Attachments) is gated by
  // exactly `shipping.view`/`shipping.edit` (see SalesScopeService), not a
  // new bespoke permission.
  const shippingUser = await prisma.user.upsert({
    where: { email: 'shipping@oms.local' },
    update: {
      username: 'shipping',
      jobTitleId: jobTitleByName.get('موظف الشحن')!.id,
    },
    create: {
      email: 'shipping@oms.local',
      username: 'shipping',
      fullName: 'Faisal Otaibi',
      passwordHash,
      jobTitleId: jobTitleByName.get('موظف الشحن')!.id,
    },
  });
  await grantPermissions(shippingUser.id, [
    'store-orders.view',
    'shipping.view',
    'shipping.edit',
    'shipping.print',
    'shipping.export',
  ]);

  // HR test persona — administers Employees/Compensation/KPI/Commission
  // Plans/Sales Targets and can carry a Payroll Run through HR review, but
  // never Finance-approve/post/pay (separation of duties mirrors the
  // Finance vs Finance Manager split above).
  const hrUser = await prisma.user.upsert({
    where: { email: 'hr@oms.local' },
    update: {
      username: 'hr',
      jobTitleId: jobTitleByName.get('أخصائي الموارد البشرية')!.id,
    },
    create: {
      email: 'hr@oms.local',
      username: 'hr',
      fullName: 'Noura Al-Harbi',
      passwordHash,
      jobTitleId: jobTitleByName.get('أخصائي الموارد البشرية')!.id,
    },
  });
  await grantPermissions(hrUser.id, [
    'hr.view',
    // TASK-062 Security Hardening — HR owns Department/Job Title Master
    // Data (organizational structure feeds Employee records HR maintains).
    'masterdata.departments.view',
    'masterdata.departments.create',
    'masterdata.departments.edit',
    'masterdata.departments.archive',
    'masterdata.job-titles.view',
    'masterdata.job-titles.create',
    'masterdata.job-titles.edit',
    'masterdata.job-titles.archive',
    'hr.employees.view',
    'hr.employees.create',
    'hr.employees.edit',
    'hr.employees.export',
    'hr.employees.archive',
    'hr.compensation.view',
    'hr.compensation.create',
    'hr.compensation.edit',
    'hr.payroll-components.view',
    'hr.payroll-components.create',
    'hr.payroll-components.edit',
    'hr.payroll-components.archive',
    'hr.kpi-templates.view',
    'hr.kpi-templates.create',
    'hr.kpi-templates.edit',
    'hr.kpi-templates.archive',
    'hr.kpi-evaluations.view',
    'hr.kpi-evaluations.edit',
    'hr.kpi-evaluations.approve',
    'hr.kpi-evaluations.reopen',
    'hr.sales-targets.view',
    'hr.sales-targets.create',
    'hr.sales-targets.edit',
    'hr.sales-targets.delete',
    'hr.commission-plans.view',
    'hr.commission-plans.create',
    'hr.commission-plans.edit',
    'hr.commission-plans.archive',
    'hr.commissions.view',
    'hr.commissions.approve',
    'hr.commissions.adjust',
    'hr.payroll.view',
    'hr.payroll.create',
    'hr.payroll.edit',
    'hr.payroll.hr-review',
    'hr.payroll.print',
    'hr.payroll.export',
  ]);

  // (Department/People) Manager test persona — distinct from Sales
  // Manager: read-only visibility into their area's HR data (a real
  // subordinate + "score this employee's MANAGER-source KPI item" is
  // relationship-gated by EmployeeProfile.managerEmployeeId, not a
  // permission string — see KpiEvaluationsService.assertCanScore — and is
  // already exercised end-to-end by hr-milestone-e2e.spec.ts).
  const managerUser = await prisma.user.upsert({
    where: { email: 'manager@oms.local' },
    update: {
      username: 'manager',
      jobTitleId: jobTitleByName.get('مدير التشغيل')!.id,
    },
    create: {
      email: 'manager@oms.local',
      username: 'manager',
      fullName: 'Khalid Ghamdi',
      passwordHash,
      jobTitleId: jobTitleByName.get('مدير التشغيل')!.id,
    },
  });
  await grantPermissions(managerUser.id, [
    'hr.view',
    'hr.employees.view',
    'hr.kpi-evaluations.view',
    'hr.sales-targets.view',
    'hr.commissions.view',
    'hr.payroll.view',
    // Investor Engine Milestone 1, Phase 19 — read-only oversight, same
    // philosophy as this persona's HR visibility above.
    'investors.view',
    'investment-opportunities.view',
    'investor-subscriptions.view',
    // Investor Engine Milestone 2 — same read-only oversight philosophy.
    'investment-sales.view',
    'investment-expenses.view',
    'investment-profit.view',
    'investment-settlement.view',
    // Investor Engine Milestone 3 — same read-only oversight philosophy.
    'investment-distributions.view',
    'investment-payments.view',
    'investor-ledger.view',
    'capital-returns.view',
    // Investor Engine Milestone 4 — same read-only oversight philosophy.
    'investor-settings.view',
    'investor-portal.view',
  ]);

  // Employee test persona — deliberately zero module permissions, so a
  // regression pass can verify every gated section/action stays hidden
  // rather than defaulting open for an authenticated-but-unprivileged user.
  const employeeUser = await prisma.user.upsert({
    where: { email: 'employee@oms.local' },
    update: {
      username: 'employee',
      jobTitleId: jobTitleByName.get('موظف خدمة العملاء')!.id,
    },
    create: {
      email: 'employee@oms.local',
      username: 'employee',
      fullName: 'Rania Qassemi',
      passwordHash,
      jobTitleId: jobTitleByName.get('موظف خدمة العملاء')!.id,
    },
  });

  // Sales Team — gives salesManagerUser real TEAM scope over Agent A/B in
  // SalesScopeService.resolve() (kind: 'TEAM'), the actual mechanism Sales
  // Manager / Team Manager visibility and Assign/Distribute rely on.
  const salesTeam = await prisma.salesTeam.upsert({
    where: { code: 'TEAM-SALES-1' },
    update: {
      managerId: salesManagerUser.id,
      departmentId: salesDepartment.id,
    },
    create: {
      code: 'TEAM-SALES-1',
      name: 'فريق المبيعات الأول',
      departmentId: salesDepartment.id,
      managerId: salesManagerUser.id,
    },
  });
  for (const memberId of [salesUser.id, salesUserB.id]) {
    await prisma.salesTeamMember.upsert({
      where: {
        salesTeamId_userId: { salesTeamId: salesTeam.id, userId: memberId },
      },
      update: {},
      create: { salesTeamId: salesTeam.id, userId: memberId },
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
  // Sales agents, Sales Manager, Finance, Shipping, HR, Manager, and
  // Employee personas belong to one company only.
  for (const userId of [
    salesUser.id,
    salesUserB.id,
    salesManagerUser.id,
    financeUser.id,
    financeManagerUser.id,
    shippingUser.id,
    hrUser.id,
    managerUser.id,
    employeeUser.id,
  ]) {
    await prisma.companyMembership.upsert({
      where: { userId_companyId: { userId, companyId: acme.id } },
      update: {},
      create: { userId, companyId: acme.id, branchId: acmeMain.id },
    });
  }

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
      // Unified Partner Architecture — replaces the former SUPPLIER/CUSTOMER
      // series (Customer/Supplier no longer exist as separate identities).
      documentType: 'PARTNER',
      label: 'Partner',
      docCode: 'PT',
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
      // Cash Flow module — Outgoing Expense Payment Voucher.
      documentType: 'EXPENSE_PAYMENT',
      label: 'Expense Payment',
      docCode: 'EP',
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
      // Investor Engine Milestone 1 — deliberately a distinct documentType
      // from the dormant 'OPPORTUNITY'/'OPP' row above (that one is
      // ambiguously scoped to a future CRM concept, never consumed by any
      // module) — same "don't collide with a differently-scoped existing
      // key" reasoning as SALES_ORDER_DOC vs SALES_ORDER.
      documentType: 'INVESTMENT_OPPORTUNITY',
      label: 'Investment Opportunity',
      docCode: 'IOP',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      // Investor Engine Milestone 3.
      documentType: 'PROFIT_DISTRIBUTION',
      label: 'Profit Distribution',
      docCode: 'PDIST',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
    {
      documentType: 'CAPITAL_RETURN',
      label: 'Capital Return',
      docCode: 'CRET',
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
      documentType: 'DEPARTMENT',
      label: 'Department',
      docCode: 'DEPT',
      template: '{DOC}-{SEQ}',
      yearReset: false,
    },
    {
      documentType: 'CUSTOMER_CLASSIFICATION',
      label: 'Customer Classification',
      docCode: 'CC',
      template: '{DOC}-{SEQ}',
      yearReset: false,
    },
    {
      documentType: 'NO_PURCHASE_REASON',
      label: 'No Purchase Reason',
      docCode: 'NPR',
      template: '{DOC}-{SEQ}',
      yearReset: false,
    },
    {
      documentType: 'JOB_TITLE',
      label: 'Job Title',
      docCode: 'JT',
      template: '{DOC}-{SEQ}',
      yearReset: false,
    },
    {
      documentType: 'SALES_TEAM',
      label: 'Sales Team',
      docCode: 'ST',
      template: '{DOC}-{SEQ}',
      yearReset: false,
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
    {
      // Store Orders + Shipping Operations — independent storefront/
      // marketplace order pipeline (never the Leads->SalesOrder 'SALES_ORDER'
      // key above, and never the B2B 'SALES_ORDER_DOC' key). internalOrderId
      // is always app-generated here, never client-supplied.
      documentType: 'STORE_ORDER',
      label: 'Store Order',
      docCode: 'STO',
      template: '{DOC}-{YEAR}-{SEQ}',
    },
  ];

  // -----------------------------------------------------------------------
  // Investor Engine Milestone 1 — deterministic test fixtures (Phase 43/46).
  // Mirrors the milestone's own acceptance example exactly: Opportunity
  // "Muhbara Investment Cycle Test" (Product A: 1000x100, Product B:
  // 500x60 -> Target Capital 130,000 SAR), Investor A fully confirmed at
  // 65,000 and Investor B partially confirmed at 30,000 with a second,
  // still-PENDING 35,000 contribution left for a Finance user to confirm
  // during manual QA (watching participation shift from 68.421/31.579 to
  // 50/50 and the Opportunity auto-transition to FUNDED). Dev/test fixture
  // only — never run against Production data.
  // -----------------------------------------------------------------------
  const sarCurrency = await prisma.currency.findUnique({
    where: { code: 'SAR' },
  });
  const piece = await prisma.unit.findUnique({ where: { name: 'قطعة' } });
  const booksCategory = await prisma.productCategory.findFirst({
    where: { name: 'كتب', deletedAt: null },
  });

  if (sarCurrency && piece && booksCategory) {
    const investorAPartner = await prisma.partner.upsert({
      where: { partnerNumber: 'PT-TEST-INV-A' },
      update: { name: 'مستثمر تجريبي أ' },
      create: {
        partnerNumber: 'PT-TEST-INV-A',
        name: 'مستثمر تجريبي أ',
        entityType: 'PERSON',
        phone: '0500000001',
        email: 'investor-a-test@oms.local',
        status: 'ACTIVE',
      },
    });
    await prisma.partnerRoleAssignment.upsert({
      where: {
        partnerId_role: { partnerId: investorAPartner.id, role: 'INVESTOR' },
      },
      update: {},
      create: { partnerId: investorAPartner.id, role: 'INVESTOR' },
    });
    const investorA = await prisma.investorProfile.upsert({
      where: { partnerId: investorAPartner.id },
      update: {},
      create: { partnerId: investorAPartner.id },
    });

    const investorBPartner = await prisma.partner.upsert({
      where: { partnerNumber: 'PT-TEST-INV-B' },
      update: { name: 'مستثمر تجريبي ب' },
      create: {
        partnerNumber: 'PT-TEST-INV-B',
        name: 'مستثمر تجريبي ب',
        entityType: 'PERSON',
        phone: '0500000002',
        email: 'investor-b-test@oms.local',
        status: 'ACTIVE',
      },
    });
    await prisma.partnerRoleAssignment.upsert({
      where: {
        partnerId_role: { partnerId: investorBPartner.id, role: 'INVESTOR' },
      },
      update: {},
      create: { partnerId: investorBPartner.id, role: 'INVESTOR' },
    });
    const investorB = await prisma.investorProfile.upsert({
      where: { partnerId: investorBPartner.id },
      update: {},
      create: { partnerId: investorBPartner.id },
    });

    const productA = await prisma.product.upsert({
      where: { sku: 'TEST-INV-PROD-A' },
      update: {},
      create: {
        sku: 'TEST-INV-PROD-A',
        name: 'منتج تجريبي أ',
        internalName: 'منتج تجريبي أ',
        displayName: 'Test Product A',
        categoryId: booksCategory.id,
        unitId: piece.id,
        type: 'PURCHASE_AND_SALE',
        status: 'ACTIVE',
        isPurchasable: true,
        isSellable: true,
        isInventoryItem: true,
      },
    });
    const productB = await prisma.product.upsert({
      where: { sku: 'TEST-INV-PROD-B' },
      update: {},
      create: {
        sku: 'TEST-INV-PROD-B',
        name: 'منتج تجريبي ب',
        internalName: 'منتج تجريبي ب',
        displayName: 'Test Product B',
        categoryId: booksCategory.id,
        unitId: piece.id,
        type: 'PURCHASE_AND_SALE',
        status: 'ACTIVE',
        isPurchasable: true,
        isSellable: true,
        isInventoryItem: true,
      },
    });

    const opportunity = await prisma.investmentOpportunity.upsert({
      where: { code: 'TEST-INV-001' },
      update: {},
      create: {
        code: 'TEST-INV-001',
        nameAr: 'دورة محبرة للاستثمار - تجريبي',
        nameEn: 'Muhbara Investment Cycle Test',
        currencyId: sarCurrency.id,
        startDate: new Date(),
        endDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        investorNetProfitSharePercent: 40,
        status: 'OPEN',
        createdBy: adminUser.id,
        updatedBy: adminUser.id,
      },
    });

    await prisma.opportunityProduct.upsert({
      where: {
        opportunityId_productId: {
          opportunityId: opportunity.id,
          productId: productA.id,
        },
      },
      update: {},
      create: {
        opportunityId: opportunity.id,
        productId: productA.id,
        productNameSnapshot: productA.displayName,
        fundedUnits: 1000,
        fundedUnitCost: 100,
        createdBy: adminUser.id,
        updatedBy: adminUser.id,
      },
    });
    await prisma.opportunityProduct.upsert({
      where: {
        opportunityId_productId: {
          opportunityId: opportunity.id,
          productId: productB.id,
        },
      },
      update: {},
      create: {
        opportunityId: opportunity.id,
        productId: productB.id,
        productNameSnapshot: productB.displayName,
        fundedUnits: 500,
        fundedUnitCost: 60,
        createdBy: adminUser.id,
        updatedBy: adminUser.id,
      },
    });

    // Confirmed total so far: 65,000 (A) + 30,000 (B) = 95,000 ->
    // participation 68.421...% / 31.578...% (Phase 46's mid-point).
    const subscriptionA = await prisma.investorSubscription.upsert({
      where: {
        investorId_opportunityId: {
          investorId: investorA.id,
          opportunityId: opportunity.id,
        },
      },
      update: {},
      create: {
        investorId: investorA.id,
        opportunityId: opportunity.id,
        committedAmount: 65000,
        fundedAmount: 65000,
        participationPercent: 68.4211,
        status: 'FUNDED',
        createdBy: adminUser.id,
        updatedBy: adminUser.id,
      },
    });
    const subscriptionB = await prisma.investorSubscription.upsert({
      where: {
        investorId_opportunityId: {
          investorId: investorB.id,
          opportunityId: opportunity.id,
        },
      },
      update: {},
      create: {
        investorId: investorB.id,
        opportunityId: opportunity.id,
        committedAmount: 65000,
        fundedAmount: 30000,
        participationPercent: 31.5789,
        status: 'PARTIALLY_FUNDED',
        createdBy: adminUser.id,
        updatedBy: adminUser.id,
      },
    });

    const existingContributionA = await prisma.capitalContribution.findFirst({
      where: { subscriptionId: subscriptionA.id, referenceNumber: 'SEED-A-1' },
    });
    if (!existingContributionA) {
      await prisma.capitalContribution.create({
        data: {
          subscriptionId: subscriptionA.id,
          amount: 65000,
          contributionDate: new Date(),
          referenceNumber: 'SEED-A-1',
          status: 'CONFIRMED',
          confirmedById: financeUser.id,
          confirmedAt: new Date(),
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
        },
      });
    }
    const existingContributionB1 = await prisma.capitalContribution.findFirst({
      where: { subscriptionId: subscriptionB.id, referenceNumber: 'SEED-B-1' },
    });
    if (!existingContributionB1) {
      await prisma.capitalContribution.create({
        data: {
          subscriptionId: subscriptionB.id,
          amount: 30000,
          contributionDate: new Date(),
          referenceNumber: 'SEED-B-1',
          status: 'CONFIRMED',
          confirmedById: financeUser.id,
          confirmedAt: new Date(),
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
        },
      });
    }
    // Left PENDING on purpose — confirming this during manual QA should
    // push Investor B to fully funded, flip participation to 50/50, and
    // auto-transition the Opportunity from OPEN to FUNDED.
    const existingContributionB2 = await prisma.capitalContribution.findFirst({
      where: { subscriptionId: subscriptionB.id, referenceNumber: 'SEED-B-2' },
    });
    if (!existingContributionB2) {
      await prisma.capitalContribution.create({
        data: {
          subscriptionId: subscriptionB.id,
          amount: 35000,
          contributionDate: new Date(),
          referenceNumber: 'SEED-B-2',
          status: 'PENDING',
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
        },
      });
    }

    // -------------------------------------------------------------------
    // Investor Engine Milestone 2 — deterministic fixtures reproducing the
    // mission's own exact acceptance numbers (Phase 66 Net Profit formula,
    // Phase 70 End-Date Settlement). Real StoreOrder/StoreOrderItem rows,
    // DELIVERED, never fabricated sales. Dev/test fixture only.
    // -------------------------------------------------------------------
    const testCustomer = await prisma.partner.upsert({
      where: { partnerNumber: 'PT-TEST-INV-CUSTOMER' },
      update: { name: 'عميل تجريبي - محرك الاستثمار' },
      create: {
        partnerNumber: 'PT-TEST-INV-CUSTOMER',
        name: 'عميل تجريبي - محرك الاستثمار',
        entityType: 'PERSON',
        phone: '0500000099',
        email: 'investor-engine-customer-test@oms.local',
        status: 'ACTIVE',
      },
    });
    await prisma.partnerRoleAssignment.upsert({
      where: {
        partnerId_role: { partnerId: testCustomer.id, role: 'CUSTOMER' },
      },
      update: {},
      create: { partnerId: testCustomer.id, role: 'CUSTOMER' },
    });

    const deliveredStatus = await prisma.statusDefinition.findFirst({
      where: { workflowType: 'FULFILLMENT', code: 'DELIVERED' },
    });

    if (deliveredStatus) {
      // -- Phase 66 acceptance scenario: INV-PROFIT-TEST --------------------
      // 1000 funded units @ 100 SAR cost, 40% investor share, Investor A
      // 65% / Investor B 35%. 850 units sold (170,000), 50 units returned
      // in full (10,000) -> net 800 active units / 160,000 revenue, 80,000
      // COGS, 20,000 approved expenses -> Net Profit 50,000 -> Pool 20,000
      // -> A 13,000 / B 7,000 -> Company portion 30,000.
      const profitTestOpportunity = await prisma.investmentOpportunity.upsert({
        where: { code: 'INV-PROFIT-TEST' },
        update: {},
        create: {
          code: 'INV-PROFIT-TEST',
          nameAr: 'اختبار محرك الأرباح - تجريبي',
          nameEn: 'Profit Engine Acceptance Test',
          currencyId: sarCurrency.id,
          startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
          endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          investorNetProfitSharePercent: 40,
          status: 'ACTIVE',
          activatedAt: new Date(),
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
        },
      });
      const profitTestProductA = await prisma.opportunityProduct.upsert({
        where: {
          opportunityId_productId: {
            opportunityId: profitTestOpportunity.id,
            productId: productA.id,
          },
        },
        update: {},
        create: {
          opportunityId: profitTestOpportunity.id,
          productId: productA.id,
          productNameSnapshot: productA.displayName,
          fundedUnits: 1000,
          fundedUnitCost: 100,
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
        },
      });
      const profitTestSubA = await prisma.investorSubscription.upsert({
        where: {
          investorId_opportunityId: {
            investorId: investorA.id,
            opportunityId: profitTestOpportunity.id,
          },
        },
        update: {},
        create: {
          investorId: investorA.id,
          opportunityId: profitTestOpportunity.id,
          committedAmount: 65000,
          fundedAmount: 65000,
          participationPercent: 65,
          status: 'FUNDED',
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
        },
      });
      const profitTestSubB = await prisma.investorSubscription.upsert({
        where: {
          investorId_opportunityId: {
            investorId: investorB.id,
            opportunityId: profitTestOpportunity.id,
          },
        },
        update: {},
        create: {
          investorId: investorB.id,
          opportunityId: profitTestOpportunity.id,
          committedAmount: 35000,
          fundedAmount: 35000,
          participationPercent: 35,
          status: 'FUNDED',
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
        },
      });
      for (const [sub, ref, amount] of [
        [profitTestSubA, 'SEED-PROFIT-A-1', 65000],
        [profitTestSubB, 'SEED-PROFIT-B-1', 35000],
      ] as const) {
        const existing = await prisma.capitalContribution.findFirst({
          where: { subscriptionId: sub.id, referenceNumber: ref },
        });
        if (!existing) {
          await prisma.capitalContribution.create({
            data: {
              subscriptionId: sub.id,
              amount,
              contributionDate: new Date(),
              referenceNumber: ref,
              status: 'CONFIRMED',
              confirmedById: financeUser.id,
              confirmedAt: new Date(),
              createdBy: adminUser.id,
              updatedBy: adminUser.id,
            },
          });
        }
      }

      // Three DELIVERED sales of Product A: 400 + 400 + 50 units @ 200/unit.
      const profitTestOrderSpecs = [
        { ref: 'TEST-INV-PROFIT-ORDER-1', quantity: 400 },
        { ref: 'TEST-INV-PROFIT-ORDER-2', quantity: 400 },
        { ref: 'TEST-INV-PROFIT-ORDER-3', quantity: 50 },
      ];
      const profitTestOrders: {
        orderId: string;
        itemId: string;
        quantity: number;
        revenue: number;
      }[] = [];
      for (const spec of profitTestOrderSpecs) {
        const order = await prisma.storeOrder.upsert({
          where: { internalOrderId: spec.ref },
          update: {},
          create: {
            internalOrderId: spec.ref,
            partnerId: testCustomer.id,
            currencyId: sarCurrency.id,
            fulfillmentStatusId: deliveredStatus.id,
            orderDate: new Date(),
            source: 'MANUAL',
            createdBy: adminUser.id,
            updatedBy: adminUser.id,
          },
        });
        const revenue = spec.quantity * 200;
        let item = await prisma.storeOrderItem.findFirst({
          where: { storeOrderId: order.id, productId: productA.id },
        });
        if (!item) {
          item = await prisma.storeOrderItem.create({
            data: {
              storeOrderId: order.id,
              productId: productA.id,
              quantity: spec.quantity,
              unitPrice: 200,
              agreedAmount: revenue,
            },
          });
        }
        profitTestOrders.push({
          orderId: order.id,
          itemId: item.id,
          quantity: spec.quantity,
          revenue,
        });
      }

      // Allocate 400+400 as ACTIVE (800 units / 160,000), reverse the 50-unit/10,000 order in full (a genuine return).
      for (const [index, row] of profitTestOrders.entries()) {
        const existingAllocation =
          await prisma.opportunitySaleAllocation.findFirst({
            where: {
              storeOrderItemId: row.itemId,
              opportunityId: profitTestOpportunity.id,
            },
          });
        if (existingAllocation) continue;
        const isReturned = index === 2;
        await prisma.opportunitySaleAllocation.create({
          data: {
            opportunityId: profitTestOpportunity.id,
            opportunityProductId: profitTestProductA.id,
            storeOrderId: row.orderId,
            storeOrderItemId: row.itemId,
            productId: productA.id,
            allocatedQuantity: row.quantity,
            allocatedRevenue: row.revenue,
            allocationType: 'AUTO',
            status: isReturned ? 'REVERSED' : 'ACTIVE',
            allocatedBy: adminUser.id,
            reversedAt: isReturned ? new Date() : null,
            reversedBy: isReturned ? financeUser.id : null,
            reversalReason: isReturned
              ? 'Customer return — Phase 66 acceptance scenario fixture'
              : null,
          },
        });
      }

      const existingExpense = await prisma.opportunityExpense.findFirst({
        where: {
          opportunityId: profitTestOpportunity.id,
          description: 'Seed fixture — Phase 66 approved expense',
        },
      });
      if (!existingExpense) {
        await prisma.opportunityExpense.create({
          data: {
            opportunityId: profitTestOpportunity.id,
            expenseDate: new Date(),
            category: 'OTHER',
            description: 'Seed fixture — Phase 66 approved expense',
            amount: 20000,
            status: 'APPROVED',
            approvedById: financeUser.id,
            approvedAt: new Date(),
            createdBy: adminUser.id,
          },
        });
      }

      // -- Phase 70 settlement scenario: TEST-INV-SETTLEMENT ---------------
      // Product B (1000 funded), ENDED, 850 units already allocated/sold,
      // Remaining 150; a separate real DELIVERED order of 120 still-
      // unallocated units of the same Product sits ready for the
      // Settlement Engine to suggest and commit (-> Sold 970, Remaining 30).
      const settlementOpportunity = await prisma.investmentOpportunity.upsert({
        where: { code: 'TEST-INV-SETTLEMENT' },
        update: {},
        create: {
          code: 'TEST-INV-SETTLEMENT',
          nameAr: 'اختبار محرك التسوية - تجريبي',
          nameEn: 'Settlement Engine Acceptance Test',
          currencyId: sarCurrency.id,
          startDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
          endDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          investorNetProfitSharePercent: 40,
          status: 'ENDED',
          activatedAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
          endedAt: new Date(),
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
        },
      });
      const settlementProductB = await prisma.opportunityProduct.upsert({
        where: {
          opportunityId_productId: {
            opportunityId: settlementOpportunity.id,
            productId: productB.id,
          },
        },
        update: {},
        create: {
          opportunityId: settlementOpportunity.id,
          productId: productB.id,
          productNameSnapshot: productB.displayName,
          fundedUnits: 1000,
          fundedUnitCost: 60,
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
        },
      });
      const settlementSubA = await prisma.investorSubscription.upsert({
        where: {
          investorId_opportunityId: {
            investorId: investorA.id,
            opportunityId: settlementOpportunity.id,
          },
        },
        update: {},
        create: {
          investorId: investorA.id,
          opportunityId: settlementOpportunity.id,
          committedAmount: 39000,
          fundedAmount: 39000,
          participationPercent: 65,
          status: 'FUNDED',
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
        },
      });
      await prisma.investorSubscription.upsert({
        where: {
          investorId_opportunityId: {
            investorId: investorB.id,
            opportunityId: settlementOpportunity.id,
          },
        },
        update: {},
        create: {
          investorId: investorB.id,
          opportunityId: settlementOpportunity.id,
          committedAmount: 21000,
          fundedAmount: 21000,
          participationPercent: 35,
          status: 'FUNDED',
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
        },
      });
      const existingContributionSettlementA =
        await prisma.capitalContribution.findFirst({
          where: {
            subscriptionId: settlementSubA.id,
            referenceNumber: 'SEED-SETTLEMENT-A-1',
          },
        });
      if (!existingContributionSettlementA) {
        await prisma.capitalContribution.create({
          data: {
            subscriptionId: settlementSubA.id,
            amount: 39000,
            contributionDate: new Date(),
            referenceNumber: 'SEED-SETTLEMENT-A-1',
            status: 'CONFIRMED',
            confirmedById: financeUser.id,
            confirmedAt: new Date(),
            createdBy: adminUser.id,
            updatedBy: adminUser.id,
          },
        });
      }

      const settlementSoldOrder = await prisma.storeOrder.upsert({
        where: { internalOrderId: 'TEST-INV-SETTLEMENT-ORDER-SOLD' },
        update: {},
        create: {
          internalOrderId: 'TEST-INV-SETTLEMENT-ORDER-SOLD',
          partnerId: testCustomer.id,
          currencyId: sarCurrency.id,
          fulfillmentStatusId: deliveredStatus.id,
          orderDate: new Date(),
          source: 'MANUAL',
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
        },
      });
      let settlementSoldItem = await prisma.storeOrderItem.findFirst({
        where: { storeOrderId: settlementSoldOrder.id, productId: productB.id },
      });
      if (!settlementSoldItem) {
        settlementSoldItem = await prisma.storeOrderItem.create({
          data: {
            storeOrderId: settlementSoldOrder.id,
            productId: productB.id,
            quantity: 850,
            unitPrice: 80,
            agreedAmount: 850 * 80,
          },
        });
      }
      const existingSettlementAllocation =
        await prisma.opportunitySaleAllocation.findFirst({
          where: {
            storeOrderItemId: settlementSoldItem.id,
            opportunityId: settlementOpportunity.id,
          },
        });
      if (!existingSettlementAllocation) {
        await prisma.opportunitySaleAllocation.create({
          data: {
            opportunityId: settlementOpportunity.id,
            opportunityProductId: settlementProductB.id,
            storeOrderId: settlementSoldOrder.id,
            storeOrderItemId: settlementSoldItem.id,
            productId: productB.id,
            allocatedQuantity: 850,
            allocatedRevenue: 850 * 80,
            allocationType: 'AUTO',
            status: 'ACTIVE',
            allocatedBy: adminUser.id,
          },
        });
      }

      // 120 units of Product B, DELIVERED, deliberately left unallocated —
      // the real eligible sale the Settlement Engine should suggest.
      const settlementUnallocatedOrder = await prisma.storeOrder.upsert({
        where: { internalOrderId: 'TEST-INV-SETTLEMENT-ORDER-UNALLOCATED' },
        update: {},
        create: {
          internalOrderId: 'TEST-INV-SETTLEMENT-ORDER-UNALLOCATED',
          partnerId: testCustomer.id,
          currencyId: sarCurrency.id,
          fulfillmentStatusId: deliveredStatus.id,
          orderDate: new Date(),
          source: 'MANUAL',
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
        },
      });
      const existingUnallocatedItem = await prisma.storeOrderItem.findFirst({
        where: {
          storeOrderId: settlementUnallocatedOrder.id,
          productId: productB.id,
        },
      });
      if (!existingUnallocatedItem) {
        await prisma.storeOrderItem.create({
          data: {
            storeOrderId: settlementUnallocatedOrder.id,
            productId: productB.id,
            quantity: 120,
            unitPrice: 80,
            agreedAmount: 120 * 80,
          },
        });
      }
    }
  }

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
