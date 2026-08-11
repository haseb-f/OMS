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
  actions: PermissionActionDef[];
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
    key: 'customers',
    labelKey: 'permissions.modules.customers',
    actions: [
      { action: 'view', name: 'sales.customers.view' },
      { action: 'create', name: 'sales.customers.create' },
      { action: 'edit', name: 'sales.customers.edit' },
      { action: 'delete', name: 'sales.customers.archive' },
      { action: 'export', name: 'sales.customers.export' },
    ],
  },
  {
    key: 'leads',
    labelKey: 'permissions.modules.leads',
    actions: [
      { action: 'view', name: 'crm.leads.view' },
      { action: 'create', name: 'crm.leads.create' },
      { action: 'edit', name: 'crm.leads.edit' },
      { action: 'delete', name: 'crm.leads.archive' },
      // "manage" = view every Lead/Order (not just assigned-to-self) and
      // assign/reassign/bulk-assign — the "authorized manager" capability
      // TASK-061 §6/§7 describe, distinct from the base CRUD actions above.
      { action: 'manage', name: 'crm.leads.manage' },
    ],
  },
  {
    key: 'suppliers',
    labelKey: 'permissions.modules.suppliers',
    actions: [
      { action: 'view', name: 'purchasing.suppliers.view' },
      { action: 'create', name: 'purchasing.suppliers.create' },
      { action: 'edit', name: 'purchasing.suppliers.edit' },
      { action: 'delete', name: 'purchasing.suppliers.archive' },
      { action: 'export', name: 'purchasing.suppliers.export' },
    ],
  },
  {
    key: 'products',
    labelKey: 'permissions.modules.products',
    actions: crud('products', { export: true }),
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
    actions: documentActions('sales.quotations'),
  },
  {
    key: 'sales-orders',
    labelKey: 'permissions.modules.salesOrders',
    actions: documentActions('sales.orders', { confirm: true }),
  },
  {
    key: 'sales-invoices',
    labelKey: 'permissions.modules.salesInvoices',
    actions: documentActions('sales.invoices', { confirm: true }),
  },
  {
    key: 'sales-returns',
    labelKey: 'permissions.modules.salesReturns',
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
      ...crud('accounting.chart-of-accounts', { export: true }),
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
    // Store Orders + Shipping Operations — the independent storefront/
    // marketplace order pipeline (never the Leads->SalesOrder pipeline,
    // never the B2B Sales pipeline). A top-level sidebar section of its
    // own (`navigation.config.ts`'s `store-orders` section), not nested
    // under `sales` — so its own `.view` action IS the section's gate,
    // unlike most other modules below whose section-view is a *different*,
    // coarser permission (see `IMPLIED_SECTION_PERMISSION`).
    key: 'store-orders',
    labelKey: 'permissions.modules.storeOrders',
    actions: [
      { action: 'view', name: 'store-orders.view' },
      { action: 'create', name: 'store-orders.create' },
      { action: 'edit', name: 'store-orders.edit' },
      { action: 'cancel', name: 'store-orders.cancel' },
      // "Delete" — soft-delete-only (Archive IS Delete), same convention as
      // every other document type in this catalog.
      { action: 'delete', name: 'store-orders.archive' },
      { action: 'print', name: 'store-orders.print' },
      { action: 'export', name: 'store-orders.export' },
      // "manage" = view every Store Order, not just assigned-to-self — same
      // "authorized manager" capability as `crm.leads.manage`.
      { action: 'manage', name: 'store-orders.manage' },
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
 * from that section is granted — applied once, in `UsersService.setPermissions`,
 * never duplicated at the guard/resolver layer (those only ever check the
 * exact granular permission a route declares).
 */
export const IMPLIED_SECTION_PERMISSION: Record<string, string> = {
  'sales.customers': 'sales.view',
  'crm.leads': 'crm.view',
  'sales.quotations': 'sales.view',
  'sales.orders': 'sales.view',
  'sales.invoices': 'sales.view',
  'sales.returns': 'sales.view',
  'sales.receipts': 'finance.view',
  'purchasing.suppliers': 'purchasing.view',
  'purchasing.quotations': 'purchasing.view',
  'purchasing.orders': 'purchasing.view',
  'purchasing.invoices': 'purchasing.view',
  'purchasing.returns': 'purchasing.view',
  'purchasing.payments': 'finance.view',
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
  // Both are already top-level sidebar sections gated on this exact same
  // granular permission (`navigation.config.ts`'s `store-orders`/`shipping`
  // entries) — bundling it here just means granting any one
  // `store-orders.*`/`shipping.*` permission also grants that module's own
  // `.view`, so the section reliably appears without a separate explicit
  // view grant, same as every other module in this map.
  'store-orders': 'store-orders.view',
  shipping: 'shipping.view',
};

/** Expands a granted-permission list with every implied coarse section permission (see `IMPLIED_SECTION_PERMISSION`). */
export function withImpliedSectionPermissions(names: string[]): string[] {
  const expanded = new Set(names);
  for (const name of names) {
    const modulePrefix = name.slice(0, name.lastIndexOf('.'));
    const implied = IMPLIED_SECTION_PERMISSION[modulePrefix];
    if (implied) expanded.add(implied);
  }
  return [...expanded];
}
