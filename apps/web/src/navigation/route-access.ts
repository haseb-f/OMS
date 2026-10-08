import type { AudienceUserType, NavigationItem } from "../types/navigation";
import { findNavigationAncestorByRoute, findNavigationItemByRoute } from "./build-navigation-tree";

type SearchParamsInput = URLSearchParams | string | null | undefined;

/** Agents milestone — the external agent portal's route prefix and home. */
export const AGENT_PORTAL_PREFIX = "/agent";
export const AGENT_PORTAL_HOME = "/agent";

/** R15 (D15-14) — a company partner's own portal: route prefix and home. */
export const PARTNER_PORTAL_PREFIX = "/partner";
export const PARTNER_PORTAL_HOME = "/partner";

/** Routes every audience may open (own profile / password). */
const SHARED_ROUTES = ["/profile"];

export function isUnderRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export type RouteAudienceMismatch =
  "agent-outside-portal" | "partner-outside-portal" | "internal-in-portal";

/**
 * Which audience a route belongs to (spec §3, R15): `/agent` and its children
 * are the agent portal, `/partner` and its children the partner portal,
 * everything else is internal. Returns the mismatch for the given user type,
 * or null when the route is allowed.
 */
export function routeAudienceMismatch(
  userType: AudienceUserType | undefined,
  pathname: string,
): RouteAudienceMismatch | null {
  if (SHARED_ROUTES.some((route) => isUnderRoute(pathname, route))) return null;
  const inAgentPortal = isUnderRoute(pathname, AGENT_PORTAL_PREFIX);
  const inPartnerPortal = isUnderRoute(pathname, PARTNER_PORTAL_PREFIX);
  if (userType === "AGENT") return inAgentPortal ? null : "agent-outside-portal";
  if (userType === "PARTNER") return inPartnerPortal ? null : "partner-outside-portal";
  return inAgentPortal || inPartnerPortal ? "internal-in-portal" : null;
}

/**
 * Resolves a pathname (+ search params) to the navigation entry that owns it:
 * an exact route match first, otherwise the most specific registered
 * ANCESTOR on a `/`-boundary (longest prefix wins) — so dynamic child
 * routes like `/hr/employees/<id>` or `/sales/orders/new` resolve to their
 * list entry. Routes with no registered owner (e.g. `/design-system`)
 * resolve to `undefined`.
 */
export function resolveNavigationItemForRoute(
  items: NavigationItem[],
  pathname: string,
  searchParams?: SearchParamsInput,
): NavigationItem | undefined {
  return (
    findNavigationItemByRoute(items, pathname, searchParams) ??
    findNavigationAncestorByRoute(items, pathname, searchParams)
  );
}

/**
 * D2 — the permissions a route requires, derived from the SAME
 * `navigation.config.ts` entry that decides sidebar visibility, so opening a
 * page by URL is exactly as authorized as clicking it in the sidebar.
 * Semantics match `filterByAccess` (all-of unless the entry declares
 * `permissionMatch: "any"` — see `resolveRouteAccess`). Only the
 * owning item's own list counts — section parents' coarse `*.view` keys are
 * not grantable and never gate a route. Empty = ungated.
 */
export function resolveRouteRequiredPermissions(
  items: NavigationItem[],
  pathname: string,
  searchParams?: SearchParamsInput,
): string[] {
  return resolveNavigationItemForRoute(items, pathname, searchParams)?.permissions ?? [];
}

/**
 * SEC-02 — reviewed create-route overrides. A `/new` page resolves (by
 * longest prefix) to its LIST entry, whose `.view` key is the wrong gate:
 * a role holding `*.create` but not `*.view` must still reach the create
 * page, and a role holding only `*.view` must not (the API would reject
 * the save). Each entry mirrors exactly what the API's create endpoint
 * enforces (`@PermissionModule` + POST → `create`, resolved through
 * `apps/api/src/permissions/permission-catalog.ts`) — never weaker, never
 * requiring unrelated list access. Any-of semantics: the page opens when
 * the user holds at least one listed key (every entry below has exactly
 * one because every create page posts to exactly one endpoint).
 *
 * | Route                                 | Required (any-of)                  | API create endpoint                          |
 * |---------------------------------------|------------------------------------|----------------------------------------------|
 * | /sales/quotations/new                 | sales.quotations.create            | POST /sales/quotations (sales-quotations)    |
 * | /sales/orders/new                     | sales.orders.create                | POST /sales/orders (sales-orders)            |
 * | /sales/invoices/new                   | sales.invoices.create              | POST /sales/invoices (sales-invoices)        |
 * | /sales/payments/new                   | sales.receipts.create              | POST /financial-transactions/receipts (customer-receipts) |
 * | /purchasing/purchase-quotations/new   | purchasing.quotations.create       | POST /purchasing/quotations (purchase-quotations) |
 * | /purchasing/purchase-orders/new       | purchasing.orders.create           | POST /purchase-orders (purchase-orders)      |
 * | /purchasing/purchase-invoices/new     | purchasing.invoices.create         | POST /purchasing/invoices (purchase-invoices)|
 * | /purchasing/payments/new              | purchasing.payments.create         | POST /financial-transactions/payments (supplier-payments) |
 * | /purchasing/landed-cost/new           | landed-cost.create                 | POST /landed-cost-documents (landed-cost; page gate matches) |
 * | /finance/journal-entries/new          | accounting.journal-entries.create  | POST /journal-entries (journal-entries)      |
 * | /finance/expenses/new                 | accounting.expense-payments.create | POST /financial-transactions/expense-payments (expense-payments) |
 * | /hr/employees/new                     | hr.employees.create                | POST /employees (employees)                  |
 * | /hr/kpi-templates/new                 | hr.kpi-templates.create            | POST /kpi-templates (kpi-templates)          |
 * | /hr/commission-plans/new              | hr.commission-plans.create         | POST /commission-plans (commission-plans)    |
 * | /investors/opportunities/new          | investment-opportunities.create    | POST /investment-opportunities (investment-opportunities) |
 * | /agent/orders/new                     | agent.orders.create                | POST /agent-portal/orders (agent portal)     |
 *
 * Detail routes (`/<list>/<id>`) are NOT overridden — they keep the list's
 * `.view` key. `route-access.spec.ts` fails if a `/new` page is added
 * under `app/(shell)` without an entry here.
 */
export const CREATE_ROUTE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  "/sales/quotations/new": ["sales.quotations.create"],
  "/sales/orders/new": ["sales.orders.create"],
  "/sales/invoices/new": ["sales.invoices.create"],
  "/sales/payments/new": ["sales.receipts.create"],
  "/purchasing/purchase-quotations/new": ["purchasing.quotations.create"],
  "/purchasing/purchase-orders/new": ["purchasing.orders.create"],
  "/purchasing/purchase-invoices/new": ["purchasing.invoices.create"],
  "/purchasing/payments/new": ["purchasing.payments.create"],
  "/purchasing/landed-cost/new": ["landed-cost.create"],
  "/finance/journal-entries/new": ["accounting.journal-entries.create"],
  "/finance/expenses/new": ["accounting.expense-payments.create"],
  "/hr/employees/new": ["hr.employees.create"],
  "/hr/kpi-templates/new": ["hr.kpi-templates.create"],
  "/hr/commission-plans/new": ["hr.commission-plans.create"],
  "/investors/opportunities/new": ["investment-opportunities.create"],
  // Agent portal: new order + its live quote both need agent.orders.create
  // (POST /agent-portal/orders, POST /agent-portal/orders/quote).
  "/agent/orders/new": ["agent.orders.create"],
};

export type PermissionMatch = "all" | "any";

export interface RouteAccessRequirement {
  permissions: string[];
  /** `all` — every key; `any` — at least one (create overrides, and nav entries declaring `permissionMatch: "any"`). */
  match: PermissionMatch;
  source: "create-override" | "navigation" | "ungated";
}

function normalizePath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0];
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * The shell guard's single entry point: a reviewed create override for
 * `/new` routes, otherwise the owning navigation entry's all-of keys.
 */
export function resolveRouteAccess(
  items: NavigationItem[],
  pathname: string,
  searchParams?: SearchParamsInput,
): RouteAccessRequirement {
  const override = CREATE_ROUTE_PERMISSIONS[normalizePath(pathname)];
  if (override) return { permissions: [...override], match: "any", source: "create-override" };
  const owner = resolveNavigationItemForRoute(items, pathname, searchParams);
  const permissions = owner?.permissions ?? [];
  return permissions.length > 0
    ? {
        permissions: [...permissions],
        match: owner?.permissionMatch ?? "all",
        source: "navigation",
      }
    : { permissions: [], match: "all", source: "ungated" };
}

/** Pure evaluation of a requirement against a permission check (same rule `PermissionGate` applies). */
export function isRouteAccessAllowed(
  requirement: RouteAccessRequirement,
  hasPermission: (permission: string) => boolean,
): boolean {
  if (requirement.permissions.length === 0) return true;
  return requirement.match === "any"
    ? requirement.permissions.some(hasPermission)
    : requirement.permissions.every(hasPermission);
}
