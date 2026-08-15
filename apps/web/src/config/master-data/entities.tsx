import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import { statusColumn, textColumn } from "./shared-columns";
import { formatDate } from "@/lib/date";

// ---------------------------------------------------------------------------
// Entity shapes — the subset of each Prisma model the Master Data UI reads.
// ---------------------------------------------------------------------------

export interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  warehouseType: string | null;
  isActive: boolean;
  managerId: string | null;
  manager?: { id: string; fullName: string } | null;
  defaultAnalyticAccountId: string | null;
  defaultAnalyticAccount?: { id: string; name: string } | null;
  deletedAt: string | null;
}

export interface WarehouseLocationRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  warehouseId: string;
  parentLocationId: string | null;
  isActive: boolean;
  deletedAt: string | null;
}

export interface CurrencyRow {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  deletedAt: string | null;
}

export interface CostCenterRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  deletedAt: string | null;
}

export interface ExpenseRow {
  id: string;
  date: string;
  amount: string | number;
  description: string;
  costCenterId: string | null;
  costCenter?: { id: string; code: string; name: string } | null;
  paymentMethodId: string | null;
  paymentMethod?: { id: string; name: string } | null;
  notes: string | null;
  deletedAt: string | null;
}

export interface FixedAssetRow {
  id: string;
  name: string;
  code: string | null;
  acquisitionDate: string;
  cost: string | number;
  costCenterId: string | null;
  costCenter?: { id: string; code: string; name: string } | null;
  notes: string | null;
  deletedAt: string | null;
}

export interface ProjectRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  deletedAt: string | null;
}

export interface TaxRow {
  id: string;
  code: string;
  name: string;
  rate: string | number;
  description: string | null;
  /// Accounting Configuration (TASK-047 backend / TASK-053 frontend) — VAT Output/Input account overrides, resolved by AccountMappingService.
  outputAccountId: string | null;
  inputAccountId: string | null;
  deletedAt: string | null;
}

export interface UnitRow {
  id: string;
  name: string;
  description: string | null;
  deletedAt: string | null;
}

export interface UnitConversionRow {
  id: string;
  fromUnitId: string;
  fromUnit?: { name: string };
  toUnitId: string;
  toUnit?: { name: string };
  conversionRatio: string | number;
  description: string | null;
  isActive: boolean;
  deletedAt: string | null;
}

export interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  /// TASK-047 (Accounting Configuration) — optional overrides of the
  /// Accounting Settings defaults for this category's products.
  revenueAccountId: string | null;
  revenueAccount?: { id: string; code: string; name: string } | null;
  inventoryAccountId: string | null;
  inventoryAccount?: { id: string; code: string; name: string } | null;
  cogsAccountId: string | null;
  cogsAccount?: { id: string; code: string; name: string } | null;
  purchaseAccountId: string | null;
  purchaseAccount?: { id: string; code: string; name: string } | null;
  deletedAt: string | null;
}

export interface BrandRow {
  id: string;
  name: string;
  description: string | null;
  deletedAt: string | null;
}

export interface AnalyticPlanRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  displayOrder: number;
  deletedAt: string | null;
}

export interface AnalyticAccountRow {
  id: string;
  code: string;
  name: string;
  analyticPlanId: string;
  analyticPlan?: { name: string };
  parentAccountId: string | null;
  parentAccount?: { name: string } | null;
  active: boolean;
  notes: string | null;
  deletedAt: string | null;
}

export interface PaymentMethodRow {
  id: string;
  name: string;
  description: string | null;
  accountId: string | null;
  account: { id: string; code: string; name: string } | null;
  deletedAt: string | null;
}

export interface PaymentTermRow {
  id: string;
  code: string;
  name: string;
  days: number | null;
  description: string | null;
  isActive: boolean;
  deletedAt: string | null;
}

export interface ShippingMethodRow {
  id: string;
  name: string;
  type: string;
  description: string | null;
  deletedAt: string | null;
}

export interface CustomerGroupRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  /// TASK-047 (Accounting Configuration) — optional group-level overrides.
  defaultReceivableAccountId: string | null;
  defaultReceivableAccount?: { id: string; code: string; name: string } | null;
  defaultRevenueAccountId: string | null;
  defaultRevenueAccount?: { id: string; code: string; name: string } | null;
  deletedAt: string | null;
}

export interface SupplierGroupRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  /// TASK-047 (Accounting Configuration) — optional group-level overrides.
  defaultPayableAccountId: string | null;
  defaultPayableAccount?: { id: string; code: string; name: string } | null;
  defaultPurchaseAccountId: string | null;
  defaultPurchaseAccount?: { id: string; code: string; name: string } | null;
  deletedAt: string | null;
}

export interface CountryRow {
  id: string;
  code: string;
  name: string;
  deletedAt: string | null;
}

export interface CityRow {
  id: string;
  code: string;
  name: string;
  countryId: string;
  country?: { name: string };
  deletedAt: string | null;
}

export interface LanguageRow {
  id: string;
  code: string;
  name: string;
  nativeName: string | null;
  direction: string;
  deletedAt: string | null;
}

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

export const warehousesColumns: ColumnDef<WarehouseRow, unknown>[] = [
  textColumn("code", "masterData.fields.code", (r) => r.code),
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("warehouseType", "masterData.fields.warehouseType", (r) => r.warehouseType),
  textColumn("manager", "masterData.fields.manager", (r) => r.manager?.fullName),
  statusColumn<WarehouseRow>(),
];

/** managerId/defaultAnalyticAccountId selects are resolved dynamically by the page (Users/AnalyticAccounts aren't static config data) and spliced in before `warehousesDescriptionField`. */
export const warehousesStaticFields: MasterDataFormField[] = [
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "warehouseType", label: "masterData.fields.warehouseType", type: "text" },
  { name: "isDefault", label: "masterData.fields.isDefault", type: "boolean" },
  { name: "isActive", label: "masterData.fields.isActive", type: "boolean" },
];

export const warehousesDescriptionField: MasterDataFormField = {
  name: "description",
  label: "masterData.fields.description",
  type: "textarea",
};

export const warehousesSchema = z.object({
  name: z.string().min(1),
  warehouseType: z.string().optional().or(z.literal("")),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  managerId: z.string().optional().or(z.literal("")),
  defaultAnalyticAccountId: z.string().optional().or(z.literal("")),
  description: z.string().optional().or(z.literal("")),
});

export const warehousesDefaultValues = {
  name: "",
  warehouseType: "",
  isDefault: false,
  isActive: true,
  managerId: "",
  defaultAnalyticAccountId: "",
  description: "",
};
export const warehousesExportColumns = ["code", "name", "warehouseType"];
export const warehouseRowLabel = (row: WarehouseRow) => `${row.code} — ${row.name}`;

// ---------------------------------------------------------------------------
// Currencies
// ---------------------------------------------------------------------------

export const currenciesColumns: ColumnDef<CurrencyRow, unknown>[] = [
  textColumn("code", "masterData.fields.code", (r) => r.code),
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("symbol", "masterData.fields.symbol", (r) => r.symbol),
  statusColumn<CurrencyRow>(),
];

export const currenciesFormFields: MasterDataFormField[] = [
  {
    name: "code",
    label: "masterData.fields.code",
    type: "text",
    required: true,
    placeholder: "USD",
  },
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "symbol", label: "masterData.fields.symbol", type: "text" },
];

export const currenciesSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  symbol: z.string().optional().or(z.literal("")),
});

export const currenciesDefaultValues = { code: "", name: "", symbol: "" };
export const currenciesExportColumns = ["code", "name", "symbol"];
export const currencyRowLabel = (row: CurrencyRow) => `${row.code} — ${row.name}`;

// ---------------------------------------------------------------------------
// Cost Centers (TASK-048) — referenced by JournalEntry/SalesOrder/PurchaseOrder
// ---------------------------------------------------------------------------

export const costCentersColumns: ColumnDef<CostCenterRow, unknown>[] = [
  textColumn("code", "masterData.fields.code", (r) => r.code),
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("description", "masterData.fields.description", (r) => r.description),
  statusColumn<CostCenterRow>(),
];

export const costCentersFormFields: MasterDataFormField[] = [
  { name: "code", label: "masterData.fields.code", type: "text", required: true },
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "description", label: "masterData.fields.description", type: "textarea" },
];

export const costCentersSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().or(z.literal("")),
});

export const costCentersDefaultValues = { code: "", name: "", description: "" };
export const costCentersExportColumns = ["code", "name", "description"];
export const costCenterRowLabel = (row: CostCenterRow) => `${row.code} — ${row.name}`;

// ---------------------------------------------------------------------------
// Expenses — no approval workflow, no journal-entry posting (architecture
// only, same scoping precedent as the Cost Engine Foundation). costCenterId
// and paymentMethodId options are resolved dynamically by the page, same
// pattern as Categories' account-override selects.
// ---------------------------------------------------------------------------

export const expensesColumns: ColumnDef<ExpenseRow, unknown>[] = [
  textColumn("date", "masterData.expenses.fields.date", (r) => formatDate(r.date)),
  textColumn("description", "masterData.fields.description", (r) => r.description),
  textColumn("amount", "masterData.expenses.fields.amount", (r) =>
    Number(r.amount).toLocaleString(),
  ),
  textColumn(
    "costCenter",
    "masterData.expenses.fields.costCenter",
    (r) => r.costCenter?.name ?? null,
  ),
  textColumn(
    "paymentMethod",
    "masterData.expenses.fields.paymentMethod",
    (r) => r.paymentMethod?.name ?? null,
  ),
  statusColumn<ExpenseRow>(),
];

export const expensesFormFields: MasterDataFormField[] = [
  { name: "date", label: "masterData.expenses.fields.date", type: "date", required: true },
  { name: "amount", label: "masterData.expenses.fields.amount", type: "number", required: true },
  {
    name: "description",
    label: "masterData.fields.description",
    type: "text",
    required: true,
  },
  { name: "notes", label: "masterData.fields.notes", type: "textarea" },
];

export const expensesSchema = z.object({
  date: z.string().min(1),
  amount: z.number().min(0),
  description: z.string().min(1),
  costCenterId: z.string().optional().or(z.literal("")),
  paymentMethodId: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});

export const expensesDefaultValues = {
  date: "",
  amount: 0,
  description: "",
  costCenterId: "",
  paymentMethodId: "",
  notes: "",
};
export const expensesExportColumns = ["date", "description", "amount", "notes"];
export const expenseRowLabel = (row: ExpenseRow) => `${formatDate(row.date)} — ${row.description}`;

// ---------------------------------------------------------------------------
// Fixed Assets — no depreciation calculation, no journal-entry posting
// (architecture only, same scoping precedent as Expenses). costCenterId
// options are resolved dynamically by the page.
// ---------------------------------------------------------------------------

export const fixedAssetsColumns: ColumnDef<FixedAssetRow, unknown>[] = [
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("code", "masterData.fields.code", (r) => r.code),
  textColumn("acquisitionDate", "masterData.fixedAssets.fields.acquisitionDate", (r) =>
    formatDate(r.acquisitionDate),
  ),
  textColumn("cost", "masterData.fixedAssets.fields.cost", (r) => Number(r.cost).toLocaleString()),
  textColumn(
    "costCenter",
    "masterData.expenses.fields.costCenter",
    (r) => r.costCenter?.name ?? null,
  ),
  statusColumn<FixedAssetRow>(),
];

export const fixedAssetsFormFields: MasterDataFormField[] = [
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "code", label: "masterData.fields.code", type: "text" },
  {
    name: "acquisitionDate",
    label: "masterData.fixedAssets.fields.acquisitionDate",
    type: "date",
    required: true,
  },
  { name: "cost", label: "masterData.fixedAssets.fields.cost", type: "number", required: true },
  { name: "notes", label: "masterData.fields.notes", type: "textarea" },
];

export const fixedAssetsSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional().or(z.literal("")),
  acquisitionDate: z.string().min(1),
  cost: z.number().min(0),
  costCenterId: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});

export const fixedAssetsDefaultValues = {
  name: "",
  code: "",
  acquisitionDate: "",
  cost: 0,
  costCenterId: "",
  notes: "",
};
export const fixedAssetsExportColumns = ["name", "code", "acquisitionDate", "cost", "notes"];
export const fixedAssetRowLabel = (row: FixedAssetRow) => row.name;

// ---------------------------------------------------------------------------
// Projects (TASK-048) — referenced by JournalEntry/SalesOrder/PurchaseOrder
// ---------------------------------------------------------------------------

export const projectsColumns: ColumnDef<ProjectRow, unknown>[] = [
  textColumn("code", "masterData.fields.code", (r) => r.code),
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("description", "masterData.fields.description", (r) => r.description),
  statusColumn<ProjectRow>(),
];

export const projectsFormFields: MasterDataFormField[] = [
  { name: "code", label: "masterData.fields.code", type: "text", required: true },
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "description", label: "masterData.fields.description", type: "textarea" },
];

export const projectsSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().or(z.literal("")),
});

export const projectsDefaultValues = { code: "", name: "", description: "" };
export const projectsExportColumns = ["code", "name", "description"];
export const projectRowLabel = (row: ProjectRow) => `${row.code} — ${row.name}`;

// ---------------------------------------------------------------------------
// Taxes
// ---------------------------------------------------------------------------

export const taxesColumns: ColumnDef<TaxRow, unknown>[] = [
  textColumn("code", "masterData.fields.code", (r) => r.code),
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("rate", "masterData.fields.rate", (r) => String(r.rate)),
  statusColumn<TaxRow>(),
];

export const taxesFormFields: MasterDataFormField[] = [
  { name: "code", label: "masterData.fields.code", type: "text", required: true },
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "rate", label: "masterData.fields.rate", type: "number", required: true },
  { name: "description", label: "masterData.fields.description", type: "textarea" },
];

export const taxesSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  rate: z.number().min(0).max(100),
  description: z.string().optional().or(z.literal("")),
  outputAccountId: z.string().optional().or(z.literal("")),
  inputAccountId: z.string().optional().or(z.literal("")),
});

export const taxesDefaultValues = {
  code: "",
  name: "",
  rate: 0,
  description: "",
  outputAccountId: "",
  inputAccountId: "",
};
export const taxesExportColumns = ["code", "name", "rate"];
export const taxRowLabel = (row: TaxRow) => `${row.code} — ${row.name}`;

// ---------------------------------------------------------------------------
// Units of Measure
// ---------------------------------------------------------------------------

export const unitsColumns: ColumnDef<UnitRow, unknown>[] = [
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("description", "masterData.fields.description", (r) => r.description),
  statusColumn<UnitRow>(),
];

export const unitsFormFields: MasterDataFormField[] = [
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "description", label: "masterData.fields.description", type: "textarea" },
];

export const unitsSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().or(z.literal("")),
});

export const unitsDefaultValues = { name: "", description: "" };
export const unitsExportColumns = ["name"];
export const unitRowLabel = (row: UnitRow) => row.name;

// ---------------------------------------------------------------------------
// Unit Conversions (fromUnitId/toUnitId selects are resolved dynamically by the page)
// ---------------------------------------------------------------------------

export const unitConversionsColumns: ColumnDef<UnitConversionRow, unknown>[] = [
  textColumn("fromUnit", "masterData.fields.fromUnit", (r) => r.fromUnit?.name),
  textColumn("toUnit", "masterData.fields.toUnit", (r) => r.toUnit?.name),
  textColumn("conversionRatio", "masterData.fields.conversionRatio", (r) =>
    String(r.conversionRatio),
  ),
  textColumn("description", "masterData.fields.description", (r) => r.description),
  statusColumn<UnitConversionRow>(),
];

export const unitConversionsStaticFields: MasterDataFormField[] = [
  {
    name: "conversionRatio",
    label: "masterData.fields.conversionRatio",
    type: "number",
    required: true,
  },
  { name: "description", label: "masterData.fields.description", type: "textarea" },
];

export const unitConversionsSchema = z.object({
  fromUnitId: z.string().min(1),
  toUnitId: z.string().min(1),
  conversionRatio: z.number().positive(),
  description: z.string().optional().or(z.literal("")),
});

export const unitConversionsDefaultValues = {
  fromUnitId: "",
  toUnitId: "",
  conversionRatio: undefined,
  description: "",
};
export const unitConversionsExportColumns = ["fromUnit", "toUnit", "conversionRatio"];
export const unitConversionRowLabel = (row: UnitConversionRow) =>
  `${row.fromUnit?.name ?? row.fromUnitId} → ${row.toUnit?.name ?? row.toUnitId}`;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const categoriesColumns: ColumnDef<CategoryRow, unknown>[] = [
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("description", "masterData.fields.description", (r) => r.description),
  statusColumn<CategoryRow>(),
];

export const categoriesFormFields: MasterDataFormField[] = [
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "description", label: "masterData.fields.description", type: "textarea" },
];

/** TASK-047 — the 4 account-override fields, built with dynamic `options` at the page level (same pattern as ChartOfAccounts' own parentAccountId). */
export const categoriesAccountFieldNames = [
  "revenueAccountId",
  "inventoryAccountId",
  "cogsAccountId",
  "purchaseAccountId",
] as const;

export const categoriesSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().or(z.literal("")),
  revenueAccountId: z.string().optional().or(z.literal("")),
  inventoryAccountId: z.string().optional().or(z.literal("")),
  cogsAccountId: z.string().optional().or(z.literal("")),
  purchaseAccountId: z.string().optional().or(z.literal("")),
});

export const categoriesDefaultValues = {
  name: "",
  description: "",
  revenueAccountId: "",
  inventoryAccountId: "",
  cogsAccountId: "",
  purchaseAccountId: "",
};
export const categoriesExportColumns = ["name"];
export const categoryRowLabel = (row: CategoryRow) => row.name;

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

export const brandsColumns: ColumnDef<BrandRow, unknown>[] = [
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("description", "masterData.fields.description", (r) => r.description),
  statusColumn<BrandRow>(),
];

export const brandsFormFields: MasterDataFormField[] = [
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "description", label: "masterData.fields.description", type: "textarea" },
];

export const brandsSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().or(z.literal("")),
});

export const brandsDefaultValues = { name: "", description: "" };
export const brandsExportColumns = ["name"];
export const brandRowLabel = (row: BrandRow) => row.name;

// ---------------------------------------------------------------------------
// Analytic Plans (خطط التحليل) — TASK-025, replaces Cost Centers
// ---------------------------------------------------------------------------

export const analyticPlansColumns: ColumnDef<AnalyticPlanRow, unknown>[] = [
  textColumn("code", "masterData.fields.code", (r) => r.code),
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("displayOrder", "masterData.fields.displayOrder", (r) => String(r.displayOrder)),
  statusColumn<AnalyticPlanRow>(),
];

export const analyticPlansFormFields: MasterDataFormField[] = [
  { name: "code", label: "masterData.fields.code", type: "text", required: true },
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "displayOrder", label: "masterData.fields.displayOrder", type: "number" },
  { name: "description", label: "masterData.fields.description", type: "textarea" },
];

export const analyticPlansSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  displayOrder: z.number().optional(),
  description: z.string().optional().or(z.literal("")),
});

export const analyticPlansDefaultValues = { code: "", name: "", displayOrder: 0, description: "" };
export const analyticPlansExportColumns = ["code", "name", "displayOrder"];
export const analyticPlanRowLabel = (row: AnalyticPlanRow) => `${row.code} — ${row.name}`;

// ---------------------------------------------------------------------------
// Analytic Accounts (الحسابات التحليلية) — unlimited hierarchy via
// parentAccountId; the Plan + Parent Account selects are resolved
// dynamically by the page (same pattern as Branches' companyId).
// ---------------------------------------------------------------------------

export const analyticAccountsColumns: ColumnDef<AnalyticAccountRow, unknown>[] = [
  textColumn("code", "masterData.fields.code", (r) => r.code),
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("analyticPlan", "masterData.fields.analyticPlan", (r) => r.analyticPlan?.name),
  textColumn("parentAccount", "masterData.fields.parentAccount", (r) => r.parentAccount?.name),
  statusColumn<AnalyticAccountRow>(),
];

export const analyticAccountsStaticFields: MasterDataFormField[] = [
  { name: "code", label: "masterData.fields.code", type: "text", required: true },
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "notes", label: "masterData.fields.notes", type: "textarea" },
];

export const analyticAccountsSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  analyticPlanId: z.string().min(1),
  parentAccountId: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});

export const analyticAccountsDefaultValues = {
  code: "",
  name: "",
  analyticPlanId: "",
  parentAccountId: "",
  notes: "",
};
export const analyticAccountsExportColumns = ["code", "name"];
export const analyticAccountRowLabel = (row: AnalyticAccountRow) => `${row.code} — ${row.name}`;

// ---------------------------------------------------------------------------
// Chart of Accounts (دليل الحسابات) — TASK-044 Part 6, Accounting
// Foundation infrastructure only (no posting/balances/mappings). Unlimited
// hierarchy via parentAccountId; Account Type is a closed 5-value enum
// (Asset/Liability/Equity/Revenue/Expense), both resolved dynamically by
// the page (same pattern as Analytic Accounts' Plan + Parent selects).
// ---------------------------------------------------------------------------

export interface ChartOfAccountRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  accountType: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  parentAccountId: string | null;
  parentAccount?: {
    id: string;
    code: string;
    name: string;
    accountType: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  } | null;
  currencyId: string | null;
  currency?: { code: string } | null;
  allowReconciliation: boolean;
  level: number;
  /** False once this account has at least one child — a header account, never a direct journal-posting target (Part 13). */
  allowsPosting: boolean;
  /** One of the 5 permanently-protected root categories (Assets/Liabilities/Equity/Revenue/Expenses) — never deletable, set only by the server. */
  isSystemAccount: boolean;
  deletedAt: string | null;
}

export const chartOfAccountRowLabel = (row: ChartOfAccountRow) => `${row.code} — ${row.name}`;

// ---------------------------------------------------------------------------
// Journals (TASK-053) — configuration only (Name/Code/Type/default Dr-Cr
// accounts/Currency/Branch/Status); posting/numbering stay owned by the
// Posting Engine and NumberingEngineService, unchanged.
// ---------------------------------------------------------------------------

export interface JournalRow {
  id: string;
  name: string;
  code: string;
  type: "SALES" | "PURCHASE" | "CASH" | "BANK" | "GENERAL";
  sequencePrefix: string | null;
  defaultDebitAccountId: string | null;
  defaultDebitAccount?: { code: string; name: string } | null;
  defaultCreditAccountId: string | null;
  defaultCreditAccount?: { code: string; name: string } | null;
  currencyId: string | null;
  currency?: { code: string } | null;
  branchId: string | null;
  branch?: { name: string } | null;
  isActive: boolean;
  deletedAt: string | null;
}

export const journalsColumns: ColumnDef<JournalRow, unknown>[] = [
  textColumn("code", "masterData.fields.code", (r) => r.code),
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("type", "masterData.fields.journalType", (r) => r.type),
  textColumn("currency", "masterData.fields.currency", (r) => r.currency?.code),
  statusColumn<JournalRow>(),
];

export const journalsFormFields: MasterDataFormField[] = [
  { name: "code", label: "masterData.fields.code", type: "text", required: true },
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "sequencePrefix", label: "masterData.fields.sequencePrefix", type: "text" },
];

export const journalsSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["SALES", "PURCHASE", "CASH", "BANK", "GENERAL"]),
  sequencePrefix: z.string().optional().or(z.literal("")),
  defaultDebitAccountId: z.string().optional().or(z.literal("")),
  defaultCreditAccountId: z.string().optional().or(z.literal("")),
  currencyId: z.string().optional().or(z.literal("")),
  branchId: z.string().optional().or(z.literal("")),
});

export const journalsDefaultValues = {
  code: "",
  name: "",
  type: "GENERAL" as const,
  sequencePrefix: "",
  defaultDebitAccountId: "",
  defaultCreditAccountId: "",
  currencyId: "",
  branchId: "",
};
export const journalsExportColumns = ["code", "name", "type"];
export const journalRowLabel = (row: JournalRow) => `${row.code} — ${row.name}`;

// ---------------------------------------------------------------------------
// Payment Methods
// ---------------------------------------------------------------------------

export const paymentMethodsColumns: ColumnDef<PaymentMethodRow, unknown>[] = [
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("description", "masterData.fields.description", (r) => r.description),
  textColumn("account", "masterData.fields.account", (r) =>
    r.account ? `${r.account.code} — ${r.account.name}` : null,
  ),
  statusColumn<PaymentMethodRow>(),
];

export const paymentMethodsFormFields: MasterDataFormField[] = [
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "description", label: "masterData.fields.description", type: "textarea" },
  {
    name: "accountId",
    label: "masterData.fields.account",
    type: "account",
    required: true,
    postingOnly: true,
  },
];

export const paymentMethodsSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().or(z.literal("")),
  accountId: z.string().uuid(),
});

export const paymentMethodsDefaultValues = { name: "", description: "", accountId: "" };
export const paymentMethodsExportColumns = ["name"];
export const paymentMethodsToFormValues = (row: PaymentMethodRow) => ({
  name: row.name,
  description: row.description ?? "",
  accountId: row.accountId ?? "",
});
export const paymentMethodRowLabel = (row: PaymentMethodRow) => row.name;

// ---------------------------------------------------------------------------
// Payment Terms (code is auto-generated — never in formFields/schema)
// ---------------------------------------------------------------------------

export const paymentTermsColumns: ColumnDef<PaymentTermRow, unknown>[] = [
  textColumn("code", "masterData.fields.code", (r) => r.code),
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("days", "masterData.fields.days", (r) => (r.days != null ? String(r.days) : null)),
  statusColumn<PaymentTermRow>(),
];

export const paymentTermsFormFields: MasterDataFormField[] = [
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "days", label: "masterData.fields.days", type: "number" },
  { name: "isActive", label: "masterData.fields.isActive", type: "boolean" },
  { name: "description", label: "masterData.fields.description", type: "textarea" },
];

export const paymentTermsSchema = z.object({
  name: z.string().min(1),
  days: z.number().optional(),
  isActive: z.boolean().optional(),
  description: z.string().optional().or(z.literal("")),
});

export const paymentTermsDefaultValues = {
  name: "",
  days: undefined,
  isActive: true,
  description: "",
};
export const paymentTermsExportColumns = ["code", "name", "days"];
export const paymentTermRowLabel = (row: PaymentTermRow) => `${row.code} — ${row.name}`;

// ---------------------------------------------------------------------------
// Shipping Methods
// ---------------------------------------------------------------------------

export const shippingMethodsColumns: ColumnDef<ShippingMethodRow, unknown>[] = [
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("type", "masterData.fields.type", (r) => r.type),
  statusColumn<ShippingMethodRow>(),
];

/**
 * The "type" select's options are built by the page (via `t()`) since
 * `MasterDataFormField.options[].label` is pre-resolved display text, not a
 * MessageKey — this array only carries the two fields with no live-text
 * dependency.
 */
export const shippingMethodsStaticFields: MasterDataFormField[] = [
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "description", label: "masterData.fields.description", type: "textarea" },
];

export const shippingMethodsSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["INTERNAL_DELIVERY", "EXTERNAL_COMPANY"]),
  description: z.string().optional().or(z.literal("")),
});

export const shippingMethodsDefaultValues = {
  name: "",
  type: "INTERNAL_DELIVERY" as const,
  description: "",
};
export const shippingMethodsExportColumns = ["name", "type"];
export const shippingMethodRowLabel = (row: ShippingMethodRow) => row.name;

// ---------------------------------------------------------------------------
// Customer Groups
// ---------------------------------------------------------------------------

export const customerGroupsColumns: ColumnDef<CustomerGroupRow, unknown>[] = [
  textColumn("code", "masterData.fields.code", (r) => r.code),
  textColumn("name", "masterData.fields.name", (r) => r.name),
  statusColumn<CustomerGroupRow>(),
];

export const customerGroupsFormFields: MasterDataFormField[] = [
  { name: "code", label: "masterData.fields.code", type: "text", required: true },
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "description", label: "masterData.fields.description", type: "textarea" },
];

export const customerGroupsSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().or(z.literal("")),
  defaultReceivableAccountId: z.string().optional().or(z.literal("")),
  defaultRevenueAccountId: z.string().optional().or(z.literal("")),
});

export const customerGroupsDefaultValues = {
  code: "",
  name: "",
  description: "",
  defaultReceivableAccountId: "",
  defaultRevenueAccountId: "",
};
export const customerGroupsExportColumns = ["code", "name"];
export const customerGroupRowLabel = (row: CustomerGroupRow) => `${row.code} — ${row.name}`;

// ---------------------------------------------------------------------------
// Supplier Groups
// ---------------------------------------------------------------------------

export const supplierGroupsColumns: ColumnDef<SupplierGroupRow, unknown>[] = [
  textColumn("code", "masterData.fields.code", (r) => r.code),
  textColumn("name", "masterData.fields.name", (r) => r.name),
  statusColumn<SupplierGroupRow>(),
];

export const supplierGroupsFormFields: MasterDataFormField[] = [
  { name: "code", label: "masterData.fields.code", type: "text", required: true },
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "description", label: "masterData.fields.description", type: "textarea" },
];

export const supplierGroupsSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().or(z.literal("")),
  defaultPayableAccountId: z.string().optional().or(z.literal("")),
  defaultPurchaseAccountId: z.string().optional().or(z.literal("")),
});

export const supplierGroupsDefaultValues = {
  code: "",
  name: "",
  description: "",
  defaultPayableAccountId: "",
  defaultPurchaseAccountId: "",
};
export const supplierGroupsExportColumns = ["code", "name"];
export const supplierGroupRowLabel = (row: SupplierGroupRow) => `${row.code} — ${row.name}`;

// ---------------------------------------------------------------------------
// Countries
// ---------------------------------------------------------------------------

export const countriesColumns: ColumnDef<CountryRow, unknown>[] = [
  textColumn("code", "masterData.fields.code", (r) => r.code),
  textColumn("name", "masterData.fields.name", (r) => r.name),
  statusColumn<CountryRow>(),
];

export const countriesFormFields: MasterDataFormField[] = [
  {
    name: "code",
    label: "masterData.fields.code",
    type: "text",
    required: true,
    placeholder: "EG",
  },
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
];

export const countriesSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
});

export const countriesDefaultValues = { code: "", name: "" };
export const countriesExportColumns = ["code", "name"];
export const countryRowLabel = (row: CountryRow) => `${row.code} — ${row.name}`;

// ---------------------------------------------------------------------------
// Cities (countryId select is resolved dynamically by the page)
// ---------------------------------------------------------------------------

export const citiesColumns: ColumnDef<CityRow, unknown>[] = [
  textColumn("code", "masterData.fields.code", (r) => r.code),
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("country", "masterData.fields.country", (r) => r.country?.name),
  statusColumn<CityRow>(),
];

export const citiesStaticFields: MasterDataFormField[] = [
  { name: "code", label: "masterData.fields.code", type: "text", required: true },
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
];

export const citiesSchema = z.object({
  countryId: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
});

export const citiesDefaultValues = { countryId: "", code: "", name: "" };
export const citiesExportColumns = ["code", "name"];
export const cityRowLabel = (row: CityRow) => `${row.code} — ${row.name}`;

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

export const languagesColumns: ColumnDef<LanguageRow, unknown>[] = [
  textColumn("code", "masterData.fields.code", (r) => r.code),
  textColumn("name", "masterData.fields.name", (r) => r.name),
  textColumn("nativeName", "masterData.fields.nativeName", (r) => r.nativeName),
  textColumn("direction", "masterData.fields.direction", (r) => r.direction),
  statusColumn<LanguageRow>(),
];

/** The "direction" select's options are built by the page (via `t()`) — see shippingMethodsStaticFields. */
export const languagesStaticFields: MasterDataFormField[] = [
  {
    name: "code",
    label: "masterData.fields.code",
    type: "text",
    required: true,
    placeholder: "ar",
  },
  { name: "name", label: "masterData.fields.name", type: "text", required: true },
  { name: "nativeName", label: "masterData.fields.nativeName", type: "text" },
];

export const languagesSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  nativeName: z.string().optional().or(z.literal("")),
  direction: z.enum(["LTR", "RTL"]),
});

export const languagesDefaultValues = {
  code: "",
  name: "",
  nativeName: "",
  direction: "LTR" as const,
};
export const languagesExportColumns = ["code", "name", "direction"];
export const languageRowLabel = (row: LanguageRow) => `${row.code} — ${row.name}`;
