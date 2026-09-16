/**
 * TASK-060 — Enterprise Users & Permissions: the ONE catalog of every
 * grantable permission in OMS, grouped by the 23 modules Part 3 lists. This
 * is the single source of truth for: (1) which `Permission` rows `seed.ts`
 * creates, (2) the Permission Matrix UI (served via
 * `GET /permissions/catalog`), and (3) `@PermissionModule`/`@PermissionAction`
 * guard metadata on every controller — nowhere else defines a permission
 * string independently, so the matrix, the seed, and backend enforcement can
 * never drift apart.
 *
 * `action` is the canonical, user-facing operation key (Part 4's fixed
 * vocabulary: view/create/edit/delete/confirm/approve/cancel/post/reverse/
 * print/export/import/manage) — always what the Permission Matrix checkbox
 * shows. `name` is the actual `Permission.name` string stored in the
 * database and checked by `hasPermission()`/the guard; it is decoupled from
 * `action` so already-shipped permission strings (`sales.invoices.confirm`,
 * `products.archive`, ...) never have to be renamed just to fit the matrix's
 * vocabulary — "reuse existing architecture," never a parallel rename.
 * "Use only operations that actually exist for that module" (Part 4): every
 * action below corresponds to a real endpoint/button, nothing speculative.
 */

export interface PermissionActionDef {
  action: string;
  name: string;
}

export interface PermissionModuleDef {
  key: string;
  labelKey: string;
  /** Matrix/sidebar business section this row belongs to. Absent = a standalone matrix row. Never a grantable permission of its own. */
  sectionKey?: string;
  sectionLabelKey?: string;
  actions: PermissionActionDef[];
}

export interface PermissionCatalogGroup {
  sectionKey: string | null;
  sectionLabelKey: string | null;
  modules: PermissionModuleDef[];
}

const SALES_SECTION = {
  sectionKey: 'sales',
  sectionLabelKey: 'permissions.sections.sales',
} as const;

/** HR Milestone 1 — الموارد البشرية section (Employees/KPI/Targets/Commissions/Payroll). */
const HR_SECTION = {
  sectionKey: 'hr',
  sectionLabelKey: 'permissions.sections.hr',
} as const;

/** Investor Engine Milestone 1 — المستثمرون section (Investors/Opportunities/Subscriptions/Contributions). */
const INVESTORS_SECTION = {
  sectionKey: 'investors',
  sectionLabelKey: 'permissions.sections.investors',
} as const;

/** Groups catalog rows for the Permission Matrix: Sales children render under المبيعات, standalone modules stay as top-level rows. */
export function groupPermissionCatalog(
  modules: PermissionModuleDef[] = PERMISSION_CATALOG,
): PermissionCatalogGroup[] {
  const bySection = new Map<string, PermissionModuleDef[]>();
  for (const module of modules) {
    if (!module.sectionKey) continue;
    const rows = bySection.get(module.sectionKey) ?? [];
    rows.push(module);
    bySection.set(module.sectionKey, rows);
  }

  const groups: PermissionCatalogGroup[] = [];
  const seenSections = new Set<string>();
  for (const module of modules) {
    if (!module.sectionKey) {
      groups.push({
        sectionKey: null,
        sectionLabelKey: null,
        modules: [module],
      });
      continue;
    }
    if (seenSections.has(module.sectionKey)) continue;
    seenSections.add(module.sectionKey);
    groups.push({
      sectionKey: module.sectionKey,
      sectionLabelKey: module.sectionLabelKey ?? null,
      modules: bySection.get(module.sectionKey) ?? [module],
    });
  }
  return groups;
}

function crud(
  moduleName: string,
  opts: {
    create?: boolean;
    edit?: boolean;
    delete?: boolean;
    export?: boolean;
    print?: boolean;
  } = {},
): PermissionActionDef[] {
  const actions: PermissionActionDef[] = [
    { action: 'view', name: `${moduleName}.view` },
  ];
  if (opts.create !== false)
    actions.push({ action: 'create', name: `${moduleName}.create` });
  if (opts.edit !== false)
    actions.push({ action: 'edit', name: `${moduleName}.edit` });
  if (opts.delete)
    actions.push({ action: 'delete', name: `${moduleName}.delete` });
  if (opts.print)
    actions.push({ action: 'print', name: `${moduleName}.print` });
  if (opts.export)
    actions.push({ action: 'export', name: `${moduleName}.export` });
  return actions;
}

/** Sales/Purchase document workflow: Create, Edit, Approve, Confirm (where it exists), Cancel — the exact existing permission strings every document editor already checks — plus new View/Print/Export. */
function documentActions(
  moduleName: string,
  opts: { confirm?: boolean } = {},
): PermissionActionDef[] {
  const actions: PermissionActionDef[] = [
    { action: 'view', name: `${moduleName}.view` },
    { action: 'create', name: `${moduleName}.create` },
    { action: 'edit', name: `${moduleName}.edit` },
    { action: 'approve', name: `${moduleName}.approve` },
  ];
  if (opts.confirm)
    actions.push({ action: 'confirm', name: `${moduleName}.confirm` });
  actions.push(
    { action: 'cancel', name: `${moduleName}.cancel` },
    // "Delete" — every document type here is soft-delete-only (Archive IS Delete), same convention as Products/Customers/Suppliers.
    { action: 'delete', name: `${moduleName}.archive` },
    { action: 'print', name: `${moduleName}.print` },
    { action: 'export', name: `${moduleName}.export` },
  );
  return actions;
}

/**
 * TASK-062 Security Hardening — the standard shape for every plain Master
 * Data reference entity (Cities, Warehouses, Payment Methods, ...): View,
 * Create, Edit, Archive under the `masterdata.<entity>.*` name every
 * existing entity (Departments, Job Titles, Customer Classifications, No
 * Purchase Reasons) already uses and every Master Data page's
 * `permissionPrefix` prop already expects — reused here instead of inventing
 * a second naming scheme for the ~25 controllers TASK-060 never covered.
 */
function masterData(entityKey: string): PermissionActionDef[] {
  return [
    { action: 'view', name: `masterdata.${entityKey}.view` },
    { action: 'create', name: `masterdata.${entityKey}.create` },
    { action: 'edit', name: `masterdata.${entityKey}.edit` },
    { action: 'delete', name: `masterdata.${entityKey}.archive` },
  ];
}

/** Payment/Receipt workflow: Create, Edit, Confirm, Cancel — no Approve step (matches the existing `sales.receipts.*` / `purchasing.payments.*` permissions already wired into these editors). */
function paymentActions(moduleName: string): PermissionActionDef[] {
  return [
    { action: 'view', name: `${moduleName}.view` },
    { action: 'create', name: `${moduleName}.create` },
    { action: 'edit', name: `${moduleName}.edit` },
    { action: 'confirm', name: `${moduleName}.confirm` },
    { action: 'cancel', name: `${moduleName}.cancel` },
    { action: 'delete', name: `${moduleName}.archive` },
    { action: 'print', name: `${moduleName}.print` },
    { action: 'export', name: `${moduleName}.export` },
  ];
}

export const PERMISSION_CATALOG: PermissionModuleDef[] = [
  {
    key: 'dashboard',
    labelKey: 'permissions.modules.dashboard',
    actions: [{ action: 'view', name: 'dashboard.view' }],
  },
  {
    // Unified Partner Architecture — the single canonical counterparty
    // identity; Customers/Suppliers pages are role-filtered views over this
    // same registry, so one permission module governs all of them (never a
    // separate `customers`/`suppliers` module competing with it).
    key: 'partners',
    labelKey: 'permissions.modules.partners',
    actions: [
      { action: 'view', name: 'partners.view' },
      { action: 'create', name: 'partners.create' },
      { action: 'edit', name: 'partners.edit' },
      { action: 'delete', name: 'partners.archive' },
      { action: 'export', name: 'partners.export' },
      // Leads/Customers/Orders Finalization Milestone — a Sales Agent with
      // no `partners.view` (no full Partner directory browse) may still
      // resolve one exact phone number to its canonical Customer and a safe
      // previous-orders summary, to serve a returning customer without
      // granting `partners.view`'s much broader directory access.
      { action: 'lookup_global', name: 'customers.lookup_global' },
    ],
  },
  {
    key: 'sales-teams',
    labelKey: 'permissions.modules.salesTeams',
    ...SALES_SECTION,
    actions: [
      { action: 'view', name: 'crm.sales-teams.view' },
      { action: 'create', name: 'crm.sales-teams.create' },
      { action: 'edit', name: 'crm.sales-teams.edit' },
      { action: 'delete', name: 'crm.sales-teams.archive' },
    ],
  },
  {
    key: 'leads',
    labelKey: 'permissions.modules.leads',
    actions: [
      { action: 'view', name: 'crm.leads.view' },
      { action: 'create', name: 'crm.leads.create' },
      { action: 'edit', name: 'crm.leads.edit' },
      { action: 'confirm', name: 'crm.leads.convert' },
      { action: 'delete', name: 'crm.leads.archive' },
      // "manage" = view every Lead/Order (not just assigned-to-self) and
      // assign/reassign/bulk-assign — the "authorized manager" capability
      // TASK-061 §6/§7 describe, distinct from the base CRUD actions above.
      { action: 'manage', name: 'crm.leads.manage' },
    ],
  },
  {
    key: 'products',
    labelKey: 'permissions.modules.products',
    // `delete` maps to the friendlier `products.archive` name (soft delete
    // only, same as Suppliers' `purchasing.suppliers.archive`) — this was
    // previously missing entirely, so the controller's `/archive` route
    // (@PermissionAction('delete')) could never actually be granted to
    // anyone; the frontend's own `hasPermission("products.archive")`
    // check already expected this exact name.
    actions: [
      ...crud('products', { export: true }),
      { action: 'delete', name: 'products.archive' },
    ],
  },
  {
    key: 'inventory',
    labelKey: 'permissions.modules.inventory',
    actions: [
      { action: 'view', name: 'inventory.view' },
      { action: 'create', name: 'inventory.movements.create' },
      { action: 'export', name: 'inventory.export' },
    ],
  },
  {
    key: 'sales-quotations',
    labelKey: 'permissions.modules.salesQuotations',
    ...SALES_SECTION,
    actions: documentActions('sales.quotations'),
  },
  {
    key: 'sales-orders',
    labelKey: 'permissions.modules.salesOrders',
    ...SALES_SECTION,
    actions: documentActions('sales.orders', { confirm: true }),
  },
  {
    // Store Orders is a Sales operation (storefront/marketplace pipeline),
    // nested under المبيعات in both the sidebar and the Permission Matrix.
    // Action names stay `store-orders.*` so existing grants keep working.
    key: 'store-orders',
    labelKey: 'permissions.modules.storeOrders',
    ...SALES_SECTION,
    actions: [
      { action: 'view', name: 'store-orders.view' },
      { action: 'create', name: 'store-orders.create' },
      { action: 'edit', name: 'store-orders.edit' },
      { action: 'cancel', name: 'store-orders.cancel' },
      { action: 'delete', name: 'store-orders.archive' },
      { action: 'print', name: 'store-orders.print' },
      { action: 'export', name: 'store-orders.export' },
      { action: 'manage', name: 'store-orders.manage' },
      // Leads/Customers/Orders Finalization Milestone — exact Order Number
      // lookup outside the caller's own scope, read-only, distinct from
      // `store-orders.manage`'s full cross-owner browse+edit capability.
      { action: 'lookup_global', name: 'orders.lookup_global' },
      // ADR-0018 (Order Economics M2) — COGS/margin/contribution data is
      // company-sensitive in a way plain order status/customer/shipping
      // fields are not; a Sales Agent holding `store-orders.view` must
      // never automatically see it, so this is its own action rather than
      // folded into `view`.
      { action: 'profitability_view', name: 'orders.profitability.view' },
      // ADR-0018 (M2.2) — recording a Payment's ACTUAL transaction fee or a
      // Fulfillment Cost override changes a financial input, not just a view;
      // holding `profitability_view` alone must never be enough to edit one.
      {
        action: 'profitability_edit_costs',
        name: 'orders.profitability.editCosts',
      },
    ],
  },
  {
    key: 'sales-invoices',
    labelKey: 'permissions.modules.salesInvoices',
    ...SALES_SECTION,
    actions: documentActions('sales.invoices', { confirm: true }),
  },
  {
    key: 'sales-returns',
    labelKey: 'permissions.modules.salesReturns',
    ...SALES_SECTION,
    actions: documentActions('sales.returns', { confirm: true }),
  },
  {
    key: 'customer-receipts',
    labelKey: 'permissions.modules.customerReceipts',
    actions: paymentActions('sales.receipts'),
  },
  {
    key: 'purchase-quotations',
    labelKey: 'permissions.modules.purchaseQuotations',
    actions: documentActions('purchasing.quotations'),
  },
  {
    key: 'purchase-orders',
    labelKey: 'permissions.modules.purchaseOrders',
    actions: documentActions('purchasing.orders'),
  },
  {
    key: 'purchase-invoices',
    labelKey: 'permissions.modules.purchaseInvoices',
    actions: documentActions('purchasing.invoices', { confirm: true }),
  },
  {
    key: 'purchase-returns',
    labelKey: 'permissions.modules.purchaseReturns',
    actions: documentActions('purchasing.returns', { confirm: true }),
  },
  {
    // ADR-0017 (Cost Engine M1) — Landed Cost documents attach acquisition
    // costs to a CONFIRMED Purchase Invoice and post through the same
    // canonical Posting Engine. `confirm` here is the DRAFT/APPROVED →
    // POSTED transition (the one that actually capitalizes into inventory
    // and creates a Journal Entry) — mirrors purchase-invoices' own use of
    // `confirm` for its receipt/posting transition.
    key: 'landed-cost',
    labelKey: 'permissions.modules.landedCost',
    actions: documentActions('landed-cost', { confirm: true }),
  },
  {
    // Cost Explorer / Inventory Valuation / Reconciliation — read-only
    // views over the M1 costing data. Deliberately separate from
    // `expenses.view` (CostComponent/Product Cost) — company-wide
    // inventory valuation and margin-adjacent numbers are more sensitive
    // than the Cost Category vocabulary list, same reasoning
    // `purchasing.payments` already uses `finance.view` instead of
    // `purchasing.view` for money-movement visibility.
    key: 'cost-explorer',
    labelKey: 'permissions.modules.costExplorer',
    actions: [{ action: 'view', name: 'cost-explorer.view' }],
  },
  {
    key: 'supplier-payments',
    labelKey: 'permissions.modules.supplierPayments',
    actions: paymentActions('purchasing.payments'),
  },
  {
    // Cash Flow module — the "Payment Voucher" for an outgoing transaction
    // classified as an Expense (never a Supplier Payment). Distinct from
    // `supplier-payments` since it's a separate business decision (no
    // party, direct expense-account debit), not a variant of the same one.
    key: 'expense-payments',
    labelKey: 'permissions.modules.expensePayments',
    actions: paymentActions('accounting.expense-payments'),
  },
  {
    key: 'journal-entries',
    labelKey: 'permissions.modules.journalEntries',
    actions: [
      { action: 'view', name: 'accounting.journal-entries.view' },
      { action: 'create', name: 'accounting.journal-entries.create' },
      { action: 'edit', name: 'accounting.journal-entries.edit' },
      { action: 'delete', name: 'accounting.journal-entries.archive' },
      { action: 'post', name: 'accounting.journal-entries.post' },
      { action: 'reverse', name: 'accounting.journal-entries.reverse' },
      { action: 'print', name: 'accounting.journal-entries.print' },
      { action: 'export', name: 'accounting.journal-entries.export' },
    ],
  },
  {
    key: 'chart-of-accounts',
    labelKey: 'permissions.modules.chartOfAccounts',
    actions: [
      // `delete: true` (Safe Account Deletion, 2026-08-15) — the
      // controller's `archive()` endpoint already declared
      // `@PermissionAction('delete')`, but no matching catalog entry
      // existed, so `PermissionsGuard` failed closed for every
      // non-super-admin user. This registers the permission that
      // declaration always assumed existed — not a new capability, a
      // fix so the existing declared gate actually works.
      ...crud('accounting.chart-of-accounts', { export: true, delete: true }),
      // "manage" — the one action in the fixed vocabulary that fits
      // "highly-privileged admin overrides a system-generated account code"
      // (Part 12): every other employee with plain Create only ever gets
      // the server-proposed code, never a free-typed one.
      {
        action: 'manage',
        name: 'accounting.chart-of-accounts.override-code',
      },
    ],
  },
  {
    key: 'bank-transactions',
    labelKey: 'permissions.modules.bankTransactions',
    actions: [
      { action: 'view', name: 'accounting.bank-transactions.view' },
      // "manage" covers both Confirm Match and Re-run Matching — reviewing
      // and reconciling bank transactions is one Accounting business
      // operation, not two separate permissions (Part 10).
      { action: 'manage', name: 'accounting.bank-transactions.manage' },
      // Undoing a reconciliation reverses posted accounting evidence
      // (Journal Entry reversal, outstanding restored) — a stronger,
      // separately-grantable authority than confirming one, same
      // "reverse is its own permission" pattern as journal-entries above.
      // A Finance user can confirm; only Finance Manager/Admin unreconciles.
      {
        action: 'reverse',
        name: 'accounting.bank-transactions.unreconcile',
      },
    ],
  },
  {
    key: 'opening-balances',
    labelKey: 'permissions.modules.openingBalances',
    actions: [
      { action: 'view', name: 'accounting.opening-balances.view' },
      { action: 'create', name: 'accounting.opening-balances.create' },
      { action: 'print', name: 'accounting.opening-balances.print' },
      { action: 'export', name: 'accounting.opening-balances.export' },
    ],
  },
  {
    // Physical Count (stocktake) — its own lifecycle (Create, Confirm,
    // Cancel, edit a counted line) distinct from Inventory Movements.
    // `view` deliberately reuses the plain `inventory.view` name (not a
    // `inventory.physical-count.view`) so it stays governed by the same
    // "can see Inventory" boundary the `/inventory/physical-count` nav entry
    // already gates on. `create`'s name matches the permission the seed's
    // `inventoryPermissions` array already grants (TASK-048) — this closes
    // the guard that was missing, it does not rename anything.
    key: 'physical-count',
    labelKey: 'permissions.modules.physicalCount',
    actions: [
      { action: 'view', name: 'inventory.view' },
      { action: 'create', name: 'inventory.physical-count.create' },
      { action: 'edit', name: 'inventory.physical-count.edit' },
      { action: 'confirm', name: 'inventory.physical-count.confirm' },
      { action: 'cancel', name: 'inventory.physical-count.cancel' },
    ],
  },
  {
    key: 'opening-inventory',
    labelKey: 'permissions.modules.openingInventory',
    actions: [
      { action: 'view', name: 'inventory.opening-stock.view' },
      { action: 'create', name: 'inventory.opening-stock.create' },
      { action: 'export', name: 'inventory.opening-stock.export' },
    ],
  },
  {
    key: 'financial-reports',
    labelKey: 'permissions.modules.financialReports',
    actions: [
      { action: 'view', name: 'reports.financial.view' },
      { action: 'print', name: 'reports.financial.print' },
      { action: 'export', name: 'reports.financial.export' },
    ],
  },
  {
    key: 'inventory-reports',
    labelKey: 'permissions.modules.inventoryReports',
    actions: [
      { action: 'view', name: 'reports.inventory.view' },
      { action: 'print', name: 'reports.inventory.print' },
      { action: 'export', name: 'reports.inventory.export' },
    ],
  },
  {
    key: 'import-center',
    labelKey: 'permissions.modules.importCenter',
    actions: [
      { action: 'view', name: 'import-center.view' },
      { action: 'import', name: 'import-center.manage' },
      { action: 'export', name: 'import-center.export' },
      // Data Synchronization ("مزامنة البيانات") — a privileged operation
      // distinct from `import-center.manage`: reads live data from a
      // configured Google Sheets source and commits it through the same
      // pipeline a manual import uses. Granting `.manage` (configure
      // mapping templates, run manual uploads) does NOT imply `.sync`.
      { action: 'sync', name: 'import-center.sync' },
    ],
  },
  {
    key: 'departments',
    labelKey: 'permissions.modules.departments',
    actions: [
      { action: 'view', name: 'masterdata.departments.view' },
      { action: 'create', name: 'masterdata.departments.create' },
      { action: 'edit', name: 'masterdata.departments.edit' },
      { action: 'delete', name: 'masterdata.departments.archive' },
    ],
  },
  {
    key: 'customer-classifications',
    labelKey: 'permissions.modules.customerClassifications',
    actions: [
      { action: 'view', name: 'masterdata.customer-classifications.view' },
      { action: 'create', name: 'masterdata.customer-classifications.create' },
      { action: 'edit', name: 'masterdata.customer-classifications.edit' },
      { action: 'delete', name: 'masterdata.customer-classifications.archive' },
    ],
  },
  {
    key: 'no-purchase-reasons',
    labelKey: 'permissions.modules.noPurchaseReasons',
    actions: [
      { action: 'view', name: 'masterdata.no-purchase-reasons.view' },
      { action: 'create', name: 'masterdata.no-purchase-reasons.create' },
      { action: 'edit', name: 'masterdata.no-purchase-reasons.edit' },
      { action: 'delete', name: 'masterdata.no-purchase-reasons.archive' },
    ],
  },
  {
    key: 'lead-follow-up-types',
    labelKey: 'permissions.modules.leadFollowUpTypes',
    actions: [
      { action: 'view', name: 'masterdata.lead-follow-up-types.view' },
      { action: 'create', name: 'masterdata.lead-follow-up-types.create' },
      { action: 'edit', name: 'masterdata.lead-follow-up-types.edit' },
      { action: 'delete', name: 'masterdata.lead-follow-up-types.archive' },
    ],
  },
  {
    key: 'job-titles',
    labelKey: 'permissions.modules.jobTitles',
    actions: [
      { action: 'view', name: 'masterdata.job-titles.view' },
      { action: 'create', name: 'masterdata.job-titles.create' },
      { action: 'edit', name: 'masterdata.job-titles.edit' },
      { action: 'delete', name: 'masterdata.job-titles.archive' },
    ],
  },
  // TASK-062 Security Hardening — Master Data reference entities that had NO
  // backend permission guard at all (any authenticated user could read or
  // mutate them). Names/keys match the `permissionPrefix` every Master Data
  // page already sends, so this is closing a gap the frontend already
  // assumed was enforced, never a rename.
  {
    key: 'cities',
    labelKey: 'permissions.modules.cities',
    actions: masterData('cities'),
  },
  {
    key: 'countries',
    labelKey: 'permissions.modules.countries',
    actions: masterData('countries'),
  },
  {
    key: 'currencies',
    labelKey: 'permissions.modules.currencies',
    actions: masterData('currencies'),
  },
  {
    key: 'languages',
    labelKey: 'permissions.modules.languages',
    actions: masterData('languages'),
  },
  {
    key: 'transaction-types',
    labelKey: 'permissions.modules.transactionTypes',
    actions: masterData('transaction-types'),
  },
  {
    // Backs the "workflow-statuses" page (`StatusDefinitionsController`,
    // route `/status-definitions`) — key differs from the controller's own
    // route name because the frontend page's `permissionPrefix` already
    // shipped as `masterdata.workflow-statuses`.
    key: 'workflow-statuses',
    labelKey: 'permissions.modules.workflowStatuses',
    actions: masterData('workflow-statuses'),
  },
  {
    // Workflow Transition *configuration* (which permission a transition
    // requires, whether it needs approval/a reason) — distinct from
    // executing a transition, which already enforces the transition's own
    // dynamic `requiredPermission` (`WorkflowEngineService`). Coarse
    // view/manage, same shape as `settings`, since editing workflow rules is
    // a single highly-privileged admin operation, not a multi-action CRUD.
    key: 'workflow-transitions',
    labelKey: 'permissions.modules.workflowTransitions',
    actions: [
      { action: 'view', name: 'masterdata.workflow-transitions.view' },
      { action: 'manage', name: 'masterdata.workflow-transitions.manage' },
    ],
  },
  {
    key: 'customer-groups',
    labelKey: 'permissions.modules.customerGroups',
    actions: masterData('customer-groups'),
  },
  {
    key: 'supplier-groups',
    labelKey: 'permissions.modules.supplierGroups',
    actions: masterData('supplier-groups'),
  },
  {
    // Product Categories page uses `masterdata.categories` (not
    // `masterdata.product-categories`) — matches the page's existing prop.
    key: 'categories',
    labelKey: 'permissions.modules.categories',
    actions: masterData('categories'),
  },
  {
    // Product Brands page uses `masterdata.brands`, same reasoning as above.
    key: 'brands',
    labelKey: 'permissions.modules.brands',
    actions: masterData('brands'),
  },
  {
    key: 'warehouses',
    labelKey: 'permissions.modules.warehouses',
    actions: masterData('warehouses'),
  },
  {
    key: 'warehouse-locations',
    labelKey: 'permissions.modules.warehouseLocations',
    actions: masterData('warehouse-locations'),
  },
  {
    // Units AND Unit Conversions share one permission — the Unit
    // Conversions page's own `permissionPrefix` is `masterdata.units`, not a
    // separate name, so both controllers are tagged with this one module.
    key: 'units',
    labelKey: 'permissions.modules.units',
    actions: masterData('units'),
  },
  {
    key: 'payment-methods',
    labelKey: 'permissions.modules.paymentMethods',
    actions: masterData('payment-methods'),
  },
  {
    key: 'payment-terms',
    labelKey: 'permissions.modules.paymentTerms',
    actions: masterData('payment-terms'),
  },
  {
    key: 'taxes',
    labelKey: 'permissions.modules.taxes',
    actions: masterData('taxes'),
  },
  {
    key: 'cost-centers',
    labelKey: 'permissions.modules.costCenters',
    actions: masterData('cost-centers'),
  },
  {
    key: 'projects',
    labelKey: 'permissions.modules.projects',
    actions: masterData('projects'),
  },
  {
    key: 'analytic-plans',
    labelKey: 'permissions.modules.analyticPlans',
    actions: masterData('analytic-plans'),
  },
  {
    key: 'analytic-accounts',
    labelKey: 'permissions.modules.analyticAccounts',
    actions: masterData('analytic-accounts'),
  },
  {
    // Generic per-document analytic split (Analytic Distributions) — not a
    // CRUD entity of its own (no create/archive), just a read/replace pair
    // scoped to one document at a time. Reuses the `analytic-accounts`
    // permission family conceptually but needs its own grantable row since
    // "can maintain the Analytic Accounts list" and "can tag a document with
    // an analytic split" are different authorities.
    key: 'analytic-distributions',
    labelKey: 'permissions.modules.analyticDistributions',
    actions: [
      { action: 'view', name: 'masterdata.analytic-distributions.view' },
      { action: 'edit', name: 'masterdata.analytic-distributions.edit' },
    ],
  },
  {
    key: 'journals',
    labelKey: 'permissions.modules.journals',
    actions: masterData('journals'),
  },
  {
    key: 'expenses',
    labelKey: 'permissions.modules.expenses',
    actions: masterData('expenses'),
  },
  {
    key: 'fixed-assets',
    labelKey: 'permissions.modules.fixedAssets',
    actions: masterData('fixed-assets'),
  },
  {
    key: 'shipping-companies',
    labelKey: 'permissions.modules.shippingCompanies',
    actions: masterData('shipping-companies'),
  },
  {
    key: 'shipping-statuses',
    labelKey: 'permissions.modules.shippingStatuses',
    actions: masterData('shipping-statuses'),
  },
  {
    key: 'payment-sources',
    labelKey: 'permissions.modules.paymentSources',
    actions: masterData('payment-sources'),
  },
  {
    // ADR-0018 (Order Economics M2.2).
    key: 'fulfillment-cost-rules',
    labelKey: 'permissions.modules.fulfillmentCostRules',
    actions: masterData('fulfillment-cost-rules'),
  },
  {
    key: 'receiving-accounts',
    labelKey: 'permissions.modules.receivingAccounts',
    actions: masterData('receiving-accounts'),
  },
  {
    // "Only administrators can modify numbering" — the Document Numbering
    // page's own `hasPermission("numbering.manage")` check already shipped
    // with this exact name; this registers the guard the frontend always
    // assumed existed, not a new name. No separate `view`: the page loads
    // the list for anyone who can reach Settings, same as before.
    key: 'numbering',
    labelKey: 'permissions.modules.numbering',
    actions: [{ action: 'manage', name: 'numbering.manage' }],
  },
  {
    // Cost Engine Foundation (ADR-0014) — Product Cost recording/history
    // (the manual `/product-cost/:id` exception path). Cost Components moved
    // to its own granular `cost-components` module below (ADR-0017) once it
    // became a real Master Data page — this coarse pair now only covers
    // Product Cost's one write action.
    key: 'cost-engine',
    labelKey: 'permissions.modules.costEngine',
    actions: [
      { action: 'view', name: 'expenses.view' },
      { action: 'manage', name: 'expenses.manage' },
    ],
  },
  {
    // Cost Categories (ADR-0017) — promoted from the coarse `cost-engine`
    // view/manage pair to a normal granular Master Data module once it
    // became a real `MasterDataPage` (Search/Pagination/Archive/Restore),
    // matching every other entity `MasterDataPage` gates on
    // `masterdata.<entity>.*`. Implies `expenses.view` (see
    // `IMPLIED_SECTION_PERMISSION`) so the "Expenses" nav section still
    // opens for anyone holding it, same as `landed-cost` implies
    // `finance.view`.
    key: 'cost-components',
    labelKey: 'permissions.modules.costComponents',
    actions: [
      { action: 'view', name: 'masterdata.cost-components.view' },
      { action: 'create', name: 'masterdata.cost-components.create' },
      { action: 'edit', name: 'masterdata.cost-components.edit' },
      { action: 'delete', name: 'masterdata.cost-components.archive' },
    ],
  },
  {
    // Fiscal Years & Accounting Periods (TASK-051) + Posting Settings +
    // Year-End Closing — Administrator-only system configuration; one
    // module since all three are "how the books are structured/closed".
    // `accounting.fiscal-years.manage` is the exact name the Fiscal
    // Periods/Opening Balances/Year-Closing pages' own `hasPermission()`
    // checks already shipped with — this registers the guard, not a rename.
    // No separate `view`: every GET here stays open to any authenticated
    // Finance user, same as before this hardening pass.
    key: 'fiscal-configuration',
    labelKey: 'permissions.modules.fiscalConfiguration',
    actions: [{ action: 'manage', name: 'accounting.fiscal-years.manage' }],
  },
  {
    key: 'settings',
    labelKey: 'permissions.modules.settings',
    actions: [
      { action: 'view', name: 'settings.view' },
      { action: 'manage', name: 'settings.manage' },
    ],
  },
  {
    // Shipping Operations list/board — its own module (`shipping` sidebar
    // item, `GET /shipping`), separate from `store-orders` since a user can
    // be granted warehouse/shipping-desk access without full Store Order
    // visibility, and vice versa.
    key: 'shipping',
    labelKey: 'permissions.modules.shipping',
    actions: [
      { action: 'view', name: 'shipping.view' },
      { action: 'create', name: 'shipping.create' },
      { action: 'edit', name: 'shipping.edit' },
      // "manage" = bulk status updates (`POST /shipping/bulk-update`) +
      // cross-order visibility on the flat Shipping list.
      { action: 'manage', name: 'shipping.manage' },
      { action: 'import', name: 'shipping.import' },
      { action: 'export', name: 'shipping.export' },
      { action: 'print', name: 'shipping.print' },
    ],
  },
  {
    // Part AG "HR employee management" — Employee (HR person record, never
    // the same as User). Every authenticated user can always view their OWN
    // Employee profile unguarded (same "My Profile" convention as
    // settings.view above); this permission governs the Employees list and
    // any OTHER employee's profile.
    key: 'employees',
    labelKey: 'permissions.modules.employees',
    ...HR_SECTION,
    actions: [
      ...crud('hr.employees', { export: true }),
      { action: 'delete', name: 'hr.employees.archive' },
    ],
  },
  {
    // Part AG "HR compensation" — kept separate from `employees` since
    // salary is materially more sensitive than the rest of the HR record
    // (Part AL Scenario 8: a Manager may evaluate a direct report without
    // ever being able to see or edit their pay).
    key: 'compensation',
    labelKey: 'permissions.modules.compensation',
    ...HR_SECTION,
    actions: [
      { action: 'view', name: 'hr.compensation.view' },
      { action: 'create', name: 'hr.compensation.create' },
      { action: 'edit', name: 'hr.compensation.edit' },
    ],
  },
  {
    key: 'payroll-components',
    labelKey: 'permissions.modules.payrollComponents',
    ...HR_SECTION,
    actions: [
      { action: 'view', name: 'hr.payroll-components.view' },
      { action: 'create', name: 'hr.payroll-components.create' },
      { action: 'edit', name: 'hr.payroll-components.edit' },
      { action: 'delete', name: 'hr.payroll-components.archive' },
    ],
  },
  {
    key: 'kpi-templates',
    labelKey: 'permissions.modules.kpiTemplates',
    ...HR_SECTION,
    actions: [
      { action: 'view', name: 'hr.kpi-templates.view' },
      { action: 'create', name: 'hr.kpi-templates.create' },
      { action: 'edit', name: 'hr.kpi-templates.edit' },
      { action: 'delete', name: 'hr.kpi-templates.archive' },
    ],
  },
  {
    // Part N "who can evaluate" — MANAGER/HR/SYSTEM all write into the same
    // KpiEvaluation, distinguished by action: `edit` = scoring an item as
    // its assigned evaluator, `confirm` = Manager Submit, `approve` = HR
    // Approve, `manage` = HR Reopen (Part P "Locking").
    key: 'kpi-evaluations',
    labelKey: 'permissions.modules.kpiEvaluations',
    ...HR_SECTION,
    actions: [
      { action: 'view', name: 'hr.kpi-evaluations.view' },
      { action: 'edit', name: 'hr.kpi-evaluations.edit' },
      { action: 'confirm', name: 'hr.kpi-evaluations.submit' },
      { action: 'approve', name: 'hr.kpi-evaluations.approve' },
      { action: 'manage', name: 'hr.kpi-evaluations.reopen' },
    ],
  },
  {
    // Part AG "Sales target management" — Sales Manager's Target/Ranking
    // workspace.
    key: 'sales-targets',
    labelKey: 'permissions.modules.salesTargets',
    ...HR_SECTION,
    actions: [
      { action: 'view', name: 'hr.sales-targets.view' },
      { action: 'create', name: 'hr.sales-targets.create' },
      { action: 'edit', name: 'hr.sales-targets.edit' },
      { action: 'delete', name: 'hr.sales-targets.delete' },
    ],
  },
  {
    key: 'commission-plans',
    labelKey: 'permissions.modules.commissionPlans',
    ...HR_SECTION,
    actions: [
      { action: 'view', name: 'hr.commission-plans.view' },
      { action: 'create', name: 'hr.commission-plans.create' },
      { action: 'edit', name: 'hr.commission-plans.edit' },
      { action: 'delete', name: 'hr.commission-plans.archive' },
    ],
  },
  {
    // Part AG "Commission management" — reviewing/approving the calculated
    // results (Part W), distinct from configuring the Plans above.
    key: 'commissions',
    labelKey: 'permissions.modules.commissions',
    ...HR_SECTION,
    actions: [
      { action: 'view', name: 'hr.commissions.view' },
      { action: 'approve', name: 'hr.commissions.approve' },
      // Adjustment (Part W/X) — requires a reason, its own audit trail.
      { action: 'manage', name: 'hr.commissions.adjust' },
    ],
  },
  {
    // Part AG "HR payroll preparation" / "Finance payroll approval" /
    // "Payroll posting" are three distinct actions on the SAME Payroll Run,
    // not three separate modules — same one-module-many-actions pattern
    // journal-entries uses for post/reverse. HR is granted
    // create/edit/confirm; Finance is granted approve/post/manage; a
    // superuser may hold all of them.
    key: 'payroll',
    labelKey: 'permissions.modules.payroll',
    ...HR_SECTION,
    actions: [
      { action: 'view', name: 'hr.payroll.view' },
      { action: 'create', name: 'hr.payroll.create' },
      { action: 'edit', name: 'hr.payroll.edit' },
      { action: 'confirm', name: 'hr.payroll.hr-review' },
      { action: 'approve', name: 'hr.payroll.finance-approve' },
      { action: 'post', name: 'hr.payroll.post' },
      // Recording the actual payment (Part AB, distinct from Approval/Post).
      { action: 'manage', name: 'hr.payroll.pay' },
      { action: 'print', name: 'hr.payroll.print' },
      { action: 'export', name: 'hr.payroll.export' },
    ],
  },
  {
    // Investor Engine Milestone 1 — Investor (investment/business entity,
    // distinct from User/Partner Customer/Supplier roles).
    key: 'investors',
    labelKey: 'permissions.modules.investors',
    ...INVESTORS_SECTION,
    actions: [
      ...crud('investors', { export: true }),
      { action: 'delete', name: 'investors.archive' },
    ],
  },
  {
    // The central investment container — status lifecycle (Open/Activate/
    // End/Cancel) is one `manage-status` action, not a separate permission
    // per transition (same one-module-many-actions pattern as `payroll`).
    key: 'investment-opportunities',
    labelKey: 'permissions.modules.investmentOpportunities',
    ...INVESTORS_SECTION,
    actions: [
      { action: 'view', name: 'investment-opportunities.view' },
      { action: 'create', name: 'investment-opportunities.create' },
      { action: 'edit', name: 'investment-opportunities.edit' },
      { action: 'manage', name: 'investment-opportunities.manage-status' },
      { action: 'cancel', name: 'investment-opportunities.cancel' },
      { action: 'delete', name: 'investment-opportunities.archive' },
      { action: 'export', name: 'investment-opportunities.export' },
    ],
  },
  {
    // Managed mainly from within the Opportunity/Investor workspaces, not a
    // standalone sidebar page (mission Phase 37/28).
    key: 'investor-subscriptions',
    labelKey: 'permissions.modules.investorSubscriptions',
    ...INVESTORS_SECTION,
    actions: [
      { action: 'view', name: 'investor-subscriptions.view' },
      { action: 'create', name: 'investor-subscriptions.create' },
      { action: 'edit', name: 'investor-subscriptions.edit' },
    ],
  },
  {
    // Finance's Confirm/Reject authority over funding movements — same
    // payment-workflow shape as sales.receipts/purchasing.payments.
    key: 'capital-contributions',
    labelKey: 'permissions.modules.capitalContributions',
    ...INVESTORS_SECTION,
    actions: paymentActions('capital-contributions'),
  },
  {
    // Investor Engine Milestone 2 — attributing real OMS sales to
    // Opportunities (auto/recalculate/manual/reverse/return) is one
    // `manage` action (same one-module-many-actions pattern as `payroll`);
    // cross-Opportunity reallocation is a separate, more sensitive
    // `reallocate` action (request+approve+reject all gated together).
    key: 'investment-sales',
    labelKey: 'permissions.modules.investmentSales',
    ...INVESTORS_SECTION,
    actions: [
      { action: 'view', name: 'investment-sales.view' },
      { action: 'manage', name: 'investment-sales.manage' },
      { action: 'reallocate', name: 'investment-sales.reallocate' },
    ],
  },
  {
    // Opportunity-level operating costs — only Approved expenses affect the
    // Net Profit Engine, so Approve/Reject/Void share one gate distinct from
    // Create/Edit (DRAFT-only).
    key: 'investment-expenses',
    labelKey: 'permissions.modules.investmentExpenses',
    ...INVESTORS_SECTION,
    actions: [
      { action: 'view', name: 'investment-expenses.view' },
      { action: 'create', name: 'investment-expenses.create' },
      { action: 'edit', name: 'investment-expenses.edit' },
      { action: 'approve', name: 'investment-expenses.approve' },
    ],
  },
  {
    // The authoritative Net Profit Engine — recalculating a live Estimated
    // snapshot ("calculate") is separate from Approving it into an
    // immutable record the Settlement/future payout workflow relies on.
    key: 'investment-profit',
    labelKey: 'permissions.modules.investmentProfit',
    ...INVESTORS_SECTION,
    actions: [
      { action: 'view', name: 'investment-profit.view' },
      { action: 'create', name: 'investment-profit.calculate' },
      { action: 'approve', name: 'investment-profit.approve' },
    ],
  },
  {
    // End-Date Settlement workflow (Start/Review/Approve/Complete/Cancel) —
    // Approve and Complete share one gate (both commit/close real financial
    // state), same shape as `investment-sales`'s manage action.
    key: 'investment-settlement',
    labelKey: 'permissions.modules.investmentSettlement',
    ...INVESTORS_SECTION,
    actions: [
      { action: 'view', name: 'investment-settlement.view' },
      { action: 'create', name: 'investment-settlement.start' },
      { action: 'manage', name: 'investment-settlement.manage' },
      { action: 'approve', name: 'investment-settlement.approve' },
      { action: 'cancel', name: 'investment-settlement.cancel' },
    ],
  },
  {
    // Investor Engine Milestone 3 — turns an APPROVED Profit Calculation
    // into a controlled Distribution run. Create (Draft) is separate from
    // Approve (creates the accounting liability); Cancel only ever reaches
    // a DRAFT or APPROVED-but-unpaid run (service-enforced).
    key: 'investment-distributions',
    labelKey: 'permissions.modules.investmentDistributions',
    ...INVESTORS_SECTION,
    actions: [
      { action: 'view', name: 'investment-distributions.view' },
      { action: 'create', name: 'investment-distributions.create' },
      { action: 'approve', name: 'investment-distributions.approve' },
      { action: 'cancel', name: 'investment-distributions.cancel' },
    ],
  },
  {
    // Investor Engine Milestone 3 — recording/confirming actual Investor
    // profit payouts against a Distribution, same payment-workflow shape as
    // `capital-contributions`.
    key: 'investment-payments',
    labelKey: 'permissions.modules.investmentPayments',
    ...INVESTORS_SECTION,
    actions: [
      { action: 'view', name: 'investment-payments.view' },
      { action: 'create', name: 'investment-payments.create' },
      { action: 'confirm', name: 'investment-payments.confirm' },
      { action: 'cancel', name: 'investment-payments.cancel' },
    ],
  },
  {
    // Investor Engine Milestone 3 — the investor-facing subledger (Capital
    // Funded/Profit Entitlement/Profit Payment/Capital Return/Adjustment/
    // Reversal). `adjust` is separate and more sensitive than `view` since
    // it is the only way to write a manual, non-canonical entry (Phase 30).
    key: 'investor-ledger',
    labelKey: 'permissions.modules.investorLedger',
    ...INVESTORS_SECTION,
    actions: [
      { action: 'view', name: 'investor-ledger.view' },
      { action: 'manage', name: 'investor-ledger.adjust' },
    ],
  },
  {
    // Investor Engine Milestone 3 — Capital Return foundation
    // (Draft/Approve/Pay), deliberately separate gates since Pay is the
    // one that moves real cash and posts accounting.
    key: 'capital-returns',
    labelKey: 'permissions.modules.capitalReturns',
    ...INVESTORS_SECTION,
    actions: [
      { action: 'view', name: 'capital-returns.view' },
      { action: 'create', name: 'capital-returns.create' },
      { action: 'approve', name: 'capital-returns.approve' },
      { action: 'confirm', name: 'capital-returns.pay' },
      { action: 'cancel', name: 'capital-returns.cancel' },
    ],
  },
  {
    // Investor Engine Milestone 3, Phase 51 — changing the account mappings
    // is a distinct, more sensitive permission than any operational
    // Investor Finance action above; a Finance user without this cannot
    // touch the mapping even though they can create/approve/pay.
    key: 'investment-accounting',
    labelKey: 'permissions.modules.investmentAccounting',
    ...INVESTORS_SECTION,
    actions: [
      { action: 'view', name: 'investment-accounting.view' },
      { action: 'manage', name: 'investment-accounting.configure' },
    ],
  },
  {
    // Investor Engine Milestone 4, Part A — Investor Type Master Data (the
    // "Investor Settings" page). Deliberately its own module/gate, not
    // folded into `investors`: a Finance user can be granted this without
    // also holding day-to-day Investor CRUD, and vice versa.
    key: 'investor-settings',
    labelKey: 'permissions.modules.investorSettings',
    ...INVESTORS_SECTION,
    actions: [
      ...crud('investor-settings'),
      { action: 'delete', name: 'investor-settings.archive' },
    ],
  },
  {
    // Investor Engine Milestone 4, Part K — Admin management of Investor
    // Portal access (Invite/Suspend/Reactivate/Disable). Distinct from
    // `investors` CRUD: a user can manage Investor business records without
    // being able to grant them external Portal login access, or vice versa.
    key: 'investor-portal',
    labelKey: 'permissions.modules.investorPortal',
    ...INVESTORS_SECTION,
    actions: [
      { action: 'view', name: 'investor-portal.view' },
      { action: 'manage', name: 'investor-portal.manage' },
      { action: 'create', name: 'investor-portal.invite' },
    ],
  },
];

export const ALL_PERMISSION_NAMES: string[] = [
  ...new Set(
    PERMISSION_CATALOG.flatMap((module) => module.actions.map((a) => a.name)),
  ),
];

/** Every permission name a brand-new user should start with — none. "New users receive the minimum permissions... nothing else until permissions are granted" (Part 10). Their one guaranteed capability, My Profile, is not permission-gated (every authenticated user can always reach it). */
export const DEFAULT_NEW_USER_PERMISSIONS: string[] = [];

/**
 * TASK-060 Part 5 — the sidebar's top-level sections (`sales`, `purchasing`,
 * `products`, `inventory`, `finance`, `reports`, `data-management`,
 * `settings`) still gate on their own pre-existing coarse `*.view`
 * permission (`navigation.config.ts`, untouched by this task — those
 * sections also hold modules outside this task's 22-row catalog, like
 * Master Data's Journals/Cost Centers). None of those coarse permissions
 * are rows in the Permission Matrix, so granting only a granular permission
 * (e.g. "Sales Invoices → View") would leave its section invisible. This
 * map auto-bundles the matching coarse permission whenever a granular one
 * from that section is granted. Expansion runs in `UsersService.setPermissions`
 * (so the grant is persisted) and again in `PermissionsResolverService`
 * (so `/auth/me` still exposes the section key when an older row set never
 * stored it). Guards continue to check the exact granular permission a route
 * declares.
 */
export const IMPLIED_SECTION_PERMISSION: Record<
  string,
  string | readonly string[]
> = {
  // Partner spans both Sales (Customers) and Purchasing (Suppliers) — grant
  // implies both section gates, same multi-implication pattern as Store Orders.
  partners: ['sales.view', 'purchasing.view'],
  'crm.leads': 'crm.view',
  'crm.sales-teams': 'crm.view',
  'sales.quotations': 'sales.view',
  'sales.orders': 'sales.view',
  'sales.invoices': 'sales.view',
  'sales.returns': 'sales.view',
  'sales.receipts': 'finance.view',
  'purchasing.quotations': 'purchasing.view',
  'purchasing.orders': 'purchasing.view',
  'purchasing.invoices': 'purchasing.view',
  'purchasing.returns': 'purchasing.view',
  'purchasing.payments': 'finance.view',
  'landed-cost': 'finance.view',
  'masterdata.cost-components': 'expenses.view',
  'cost-explorer': 'finance.view',
  'accounting.expense-payments': 'finance.view',
  products: 'products.view',
  inventory: 'inventory.view',
  'inventory.opening-stock': 'inventory.view',
  'inventory.physical-count': 'inventory.view',
  'accounting.journal-entries': 'finance.view',
  'accounting.chart-of-accounts': 'finance.view',
  'accounting.bank-transactions': 'finance.view',
  'accounting.opening-balances': 'finance.view',
  'reports.financial': 'reports.view',
  'reports.inventory': 'reports.view',
  'import-center': 'datamanagement.view',
  settings: 'settings.view',
  'masterdata.departments': 'settings.view',
  'masterdata.customer-classifications': 'settings.view',
  'masterdata.no-purchase-reasons': 'settings.view',
  'masterdata.lead-follow-up-types': 'settings.view',
  // TASK-062 — cross-cutting geographic/workflow reference data lives under
  // the standalone "master-data" sidebar section (`masterdata.view`, never
  // itself a grantable row — same "coarse section gate" convention as
  // `finance.view`/`products.view` below).
  'masterdata.cities': 'masterdata.view',
  'masterdata.countries': 'masterdata.view',
  'masterdata.languages': 'masterdata.view',
  'masterdata.transaction-types': 'masterdata.view',
  'masterdata.workflow-statuses': 'masterdata.view',
  'masterdata.workflow-transitions': 'masterdata.view',
  // Products section — Warehouses/Units/Categories/Brands nav entries
  // already hardcode `products.view` directly, but granting only the
  // granular permission should still surface the section.
  'masterdata.warehouses': 'products.view',
  'masterdata.warehouse-locations': 'products.view',
  'masterdata.units': 'products.view',
  'masterdata.categories': 'products.view',
  'masterdata.brands': 'products.view',
  // Sales/Purchasing group pages nested under Partners.
  'masterdata.customer-groups': ['partners.view', 'sales.view'],
  'masterdata.supplier-groups': ['partners.view', 'purchasing.view'],
  // Finance section.
  'masterdata.currencies': 'finance.view',
  'masterdata.taxes': 'finance.view',
  'masterdata.cost-centers': 'finance.view',
  'masterdata.projects': 'finance.view',
  'masterdata.analytic-plans': 'finance.view',
  'masterdata.analytic-accounts': 'finance.view',
  'masterdata.analytic-distributions': 'finance.view',
  'masterdata.payment-methods': 'finance.view',
  'masterdata.payment-terms': 'finance.view',
  'masterdata.journals': 'finance.view',
  'masterdata.expenses': 'finance.view',
  'masterdata.fixed-assets': 'finance.view',
  'masterdata.payment-sources': 'finance.view',
  'masterdata.fulfillment-cost-rules': 'finance.view',
  'masterdata.receiving-accounts': 'finance.view',
  'accounting.fiscal-years': 'finance.view',
  expenses: 'expenses.view',
  // Shipping section.
  'masterdata.shipping-companies': 'shipping.view',
  'masterdata.shipping-statuses': 'shipping.view',
  numbering: 'settings.view',
  // Store Orders is nested under Sales in navigation and the matrix;
  // granting any `store-orders.*` action still implies `store-orders.view`
  // and the ungrantable Sales section gate so the parent sidebar item appears.
  'store-orders': ['store-orders.view', 'sales.view'],
  shipping: 'shipping.view',
  // HR Milestone 1 — الموارد البشرية sidebar section.
  'hr.employees': 'hr.view',
  'hr.compensation': 'hr.view',
  'hr.payroll-components': 'hr.view',
  'hr.kpi-templates': 'hr.view',
  'hr.kpi-evaluations': 'hr.view',
  'hr.sales-targets': 'hr.view',
  'hr.commission-plans': 'hr.view',
  'hr.commissions': 'hr.view',
  'hr.payroll': 'hr.view',
  // Investor Engine Milestone 1 — المستثمرون sidebar section.
  'investment-opportunities': 'investors.view',
  'investor-subscriptions': 'investors.view',
  'capital-contributions': 'investors.view',
  // Investor Engine Milestone 2 — same المستثمرون sidebar section.
  'investment-sales': 'investors.view',
  'investment-expenses': 'investors.view',
  'investment-profit': 'investors.view',
  'investment-settlement': 'investors.view',
  // Investor Engine Milestone 3 — same المستثمرون sidebar section.
  'investment-distributions': 'investors.view',
  'investment-payments': 'investors.view',
  'investor-ledger': 'investors.view',
  'capital-returns': 'investors.view',
  'investment-accounting': 'investors.view',
  // Investor Engine Milestone 4 — same المستثمرون sidebar section.
  'investor-settings': 'investors.view',
  'investor-portal': 'investors.view',
};

/** Expands a granted-permission list with every implied coarse section permission (see `IMPLIED_SECTION_PERMISSION`). */
export function withImpliedSectionPermissions(names: string[]): string[] {
  const expanded = new Set(names);
  for (const name of names) {
    const modulePrefix = name.slice(0, name.lastIndexOf('.'));
    const implied = IMPLIED_SECTION_PERMISSION[modulePrefix];
    if (!implied) continue;
    if (typeof implied === 'string') expanded.add(implied);
    else for (const permission of implied) expanded.add(permission);
  }
  return [...expanded];
}
