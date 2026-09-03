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
  'accounting.expense-payments': 'finance.view',
  products: 'products.view',
  inventory: 'inventory.view',
  'inventory.opening-stock': 'inventory.view',
  'accounting.journal-entries': 'finance.view',
  'accounting.chart-of-accounts': 'finance.view',
  'accounting.bank-transactions': 'finance.view',
  'accounting.opening-balances': 'finance.view',
  'reports.financial': 'reports.view',
  'reports.inventory': 'reports.view',
  'import-center': 'datamanagement.view',
  settings: 'settings.view',
  'masterdata.departments': 'settings.view',
  // Store Orders is nested under Sales in navigation and the matrix;
  // granting any `store-orders.*` action still implies `store-orders.view`
  // and the ungrantable Sales section gate so the parent sidebar item appears.
  'store-orders': ['store-orders.view', 'sales.view'],
  shipping: 'shipping.view',
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
