import type { NavigationItem } from "../types/navigation";

/**
 * Single source of truth for the entire OMS sidebar. Authored as a FLAT
 * list — every item declares its own `parent` id — so adding a future
 * module only ever means appending one entry here, never editing a nested
 * array or a layout component. `buildNavigationTree` (see
 * `build-navigation-tree.ts`) assembles the flat list into the nested
 * `children` structure the Sidebar actually renders.
 *
 * Reflects the backend modules that exist today (see DECISIONS.md/TODO.md).
 * Routes with no page built yet will 404 until their business pages ship in
 * a later phase — that is expected for this frontend-foundation task, not a
 * bug ("Do not start business pages yet").
 */
export const navigationConfig: NavigationItem[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    subtitle: "Overview across every OMS module",
    icon: "dashboard",
    route: "/",
    order: 0,
  },

  { id: "crm", title: "CRM", icon: "users", order: 10 },
  {
    id: "crm-leads",
    title: "Leads",
    parent: "crm",
    route: "/crm/leads",
    icon: "contact",
    order: 0,
  },

  { id: "sales", title: "Sales", icon: "shopping-cart", order: 20 },
  {
    id: "sales-orders",
    title: "Sales Orders",
    parent: "sales",
    route: "/sales/orders",
    icon: "shopping-cart",
    order: 0,
  },
  {
    id: "sales-payments",
    title: "Payments",
    parent: "sales",
    route: "/sales/payments",
    icon: "receipt",
    order: 1,
  },

  { id: "products", title: "Products", icon: "package", order: 30 },
  {
    id: "products-list",
    title: "Products",
    parent: "products",
    route: "/products",
    icon: "package",
    order: 0,
  },
  {
    id: "products-categories",
    title: "Categories",
    parent: "products",
    route: "/products/categories",
    icon: "tags",
    order: 1,
  },
  {
    id: "products-brands",
    title: "Brands",
    parent: "products",
    route: "/products/brands",
    icon: "award",
    order: 2,
  },
  {
    id: "products-units",
    title: "Units",
    parent: "products",
    route: "/products/units",
    icon: "ruler",
    order: 3,
  },

  { id: "inventory", title: "Inventory", icon: "boxes", order: 40 },
  {
    id: "inventory-movements",
    title: "Movements",
    parent: "inventory",
    route: "/inventory/movements",
    icon: "arrow-left-right",
    order: 0,
  },
  {
    id: "inventory-stock",
    title: "Stock",
    parent: "inventory",
    route: "/inventory/stock",
    icon: "layers",
    order: 1,
  },
  {
    id: "inventory-warehouses",
    title: "Warehouses",
    parent: "inventory",
    route: "/inventory/warehouses",
    icon: "warehouse",
    order: 2,
  },

  { id: "purchasing", title: "Purchasing", icon: "shopping-bag", order: 50 },
  {
    id: "purchasing-suppliers",
    title: "Suppliers",
    parent: "purchasing",
    route: "/purchasing/suppliers",
    icon: "truck",
    order: 0,
  },
  {
    id: "purchasing-orders",
    title: "Purchase Orders",
    parent: "purchasing",
    route: "/purchasing/purchase-orders",
    icon: "clipboard-list",
    order: 1,
  },

  { id: "costing", title: "Costing", icon: "calculator", order: 60 },
  {
    id: "costing-components",
    title: "Cost Components",
    parent: "costing",
    route: "/costing/cost-components",
    icon: "calculator",
    order: 0,
  },
  {
    id: "costing-product-cost",
    title: "Product Cost",
    parent: "costing",
    route: "/costing/product-cost",
    icon: "file-text",
    order: 1,
  },

  { id: "finance", title: "Finance", icon: "landmark", order: 70 },
  {
    id: "finance-chart-of-accounts",
    title: "Chart of Accounts",
    parent: "finance",
    route: "/finance/chart-of-accounts",
    icon: "file-text",
    order: 0,
  },
  {
    id: "finance-payment-sources",
    title: "Payment Sources",
    parent: "finance",
    route: "/finance/payment-sources",
    icon: "wallet",
    order: 1,
  },
  {
    id: "finance-receiving-accounts",
    title: "Receiving Accounts",
    parent: "finance",
    route: "/finance/receiving-accounts",
    icon: "credit-card",
    order: 2,
  },
  {
    id: "finance-cost-centers",
    title: "Cost Centers",
    parent: "finance",
    route: "/finance/cost-centers",
    icon: "folder-kanban",
    order: 3,
  },
  {
    id: "finance-projects",
    title: "Projects",
    parent: "finance",
    route: "/finance/projects",
    icon: "folder-kanban",
    order: 4,
  },

  { id: "settings", title: "Settings", icon: "settings", order: 80 },
  {
    id: "settings-currencies",
    title: "Currencies",
    parent: "settings",
    route: "/settings/currencies",
    icon: "coins",
    order: 0,
  },
  {
    id: "settings-countries",
    title: "Countries",
    parent: "settings",
    route: "/settings/countries",
    icon: "globe",
    order: 1,
  },
  {
    id: "settings-payment-methods",
    title: "Payment Methods",
    parent: "settings",
    route: "/settings/payment-methods",
    icon: "banknote",
    order: 2,
  },
  {
    id: "settings-shipping-methods",
    title: "Shipping Methods",
    parent: "settings",
    route: "/settings/shipping-methods",
    icon: "ship",
    order: 3,
  },
  {
    id: "settings-shipping-companies",
    title: "Shipping Companies",
    parent: "settings",
    route: "/settings/shipping-companies",
    icon: "building",
    order: 4,
  },

  { id: "identity", title: "Identity", icon: "shield-check", order: 90 },
  {
    id: "identity-users",
    title: "Users",
    parent: "identity",
    route: "/identity/users",
    icon: "users",
    order: 0,
  },
  {
    id: "identity-roles",
    title: "Roles",
    parent: "identity",
    route: "/identity/roles",
    icon: "user-cog",
    order: 1,
  },
  {
    id: "identity-permissions",
    title: "Permissions",
    parent: "identity",
    route: "/identity/permissions",
    icon: "key-round",
    order: 2,
  },
];
