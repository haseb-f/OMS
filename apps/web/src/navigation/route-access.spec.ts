import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  CREATE_ROUTE_PERMISSIONS,
  isRouteAccessAllowed,
  resolveNavigationItemForRoute,
  resolveRouteAccess,
  resolveRouteRequiredPermissions,
} from "./route-access";
import { navigationConfig } from "./navigation.config";
import type { NavigationItem } from "../types/navigation";

const config: NavigationItem[] = [
  { id: "dashboard", titleKey: "nav.dashboard", route: "/" },
  { id: "hr", titleKey: "nav.hr", permissions: ["hr.view"] },
  { id: "hr-my-profile", titleKey: "nav.hr", parent: "hr", route: "/hr/my-profile" },
  {
    id: "hr-employees",
    titleKey: "nav.hr",
    parent: "hr",
    route: "/hr/employees",
    permissions: ["hr.employees.view"],
  },
  {
    id: "investors-dashboard",
    titleKey: "nav.hr",
    route: "/investors",
    permissions: ["investors.view"],
  },
  {
    id: "investors-opportunities",
    titleKey: "nav.hr",
    route: "/investors/opportunities",
    permissions: ["investment-opportunities.view"],
  },
  {
    id: "reports-finance",
    titleKey: "nav.hr",
    route: "/reports/finance",
    permissions: ["reports.financial.view"],
  },
  {
    id: "reports-gl",
    titleKey: "nav.hr",
    route: "/reports/finance?report=generalLedger",
    permissions: ["reports.gl.view"],
  },
];

describe("resolveNavigationItemForRoute", () => {
  it("matches an exact route", () => {
    expect(resolveNavigationItemForRoute(config, "/hr/employees")?.id).toBe("hr-employees");
  });

  it("resolves dynamic child routes (/<id>, /new) to their list entry", () => {
    expect(resolveNavigationItemForRoute(config, "/hr/employees/8f2c-uuid")?.id).toBe(
      "hr-employees",
    );
    expect(resolveNavigationItemForRoute(config, "/hr/employees/new")?.id).toBe("hr-employees");
  });

  it("picks the longest registered prefix", () => {
    expect(resolveNavigationItemForRoute(config, "/investors/opportunities/new")?.id).toBe(
      "investors-opportunities",
    );
    expect(resolveNavigationItemForRoute(config, "/investors/list/abc")?.id).toBe(
      "investors-dashboard",
    );
  });

  it("only matches on a path-segment boundary", () => {
    expect(resolveNavigationItemForRoute(config, "/hr/employeesx")).toBeUndefined();
  });

  it("returns undefined for routes not in the navigation config", () => {
    expect(resolveNavigationItemForRoute(config, "/design-system")).toBeUndefined();
  });

  it("prefers the query-specific entry when its params match", () => {
    expect(
      resolveNavigationItemForRoute(config, "/reports/finance", "report=generalLedger")?.id,
    ).toBe("reports-gl");
    expect(resolveNavigationItemForRoute(config, "/reports/finance")?.id).toBe("reports-finance");
  });
});

describe("resolveRouteRequiredPermissions", () => {
  it("returns the owning item's own permissions (never the section parent's)", () => {
    expect(resolveRouteRequiredPermissions(config, "/hr/employees/42")).toEqual([
      "hr.employees.view",
    ]);
    expect(resolveRouteRequiredPermissions(config, "/hr/my-profile")).toEqual([]);
  });

  it("is ungated for the dashboard and unregistered routes", () => {
    expect(resolveRouteRequiredPermissions(config, "/")).toEqual([]);
    expect(resolveRouteRequiredPermissions(config, "/documents/preview")).toEqual([]);
  });

  it("gates the audited routes in the real navigation config", () => {
    expect(resolveRouteRequiredPermissions(navigationConfig, "/hr/employees")).toEqual([
      "hr.employees.view",
    ]);
    expect(resolveRouteRequiredPermissions(navigationConfig, "/investors/list/abc")).toEqual([
      "investors.view",
    ]);
    expect(resolveRouteRequiredPermissions(navigationConfig, "/expenses/cost-components")).toEqual([
      "masterdata.cost-components.view",
    ]);
  });
});

/** Every static `/new` page under app/(shell) (route groups stripped). */
function shellNewRoutes(): string[] {
  const root = join(process.cwd(), "src", "app", "(shell)");
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page.tsx") {
        const route = `/${relative(root, dir)
          .split(sep)
          .filter((s) => !/^\(.*\)$/.test(s))
          .join("/")}`;
        if (route.endsWith("/new")) found.push(route);
      }
    }
  };
  walk(root);
  return found.sort();
}

const grants =
  (...keys: string[]) =>
  (key: string) =>
    keys.includes(key);
const allowed = (path: string, ...keys: string[]) =>
  isRouteAccessAllowed(resolveRouteAccess(navigationConfig, path), grants(...keys));

describe("SEC-02 create-route overrides", () => {
  it("covers every /new page under app/(shell) (a new /new page must be reviewed here)", () => {
    const routes = shellNewRoutes();
    expect(routes.length).toBeGreaterThan(0);
    expect(routes).toEqual(Object.keys(CREATE_ROUTE_PERMISSIONS).sort());
  });

  it("resolves /new to the create permission with any-of semantics", () => {
    expect(resolveRouteAccess(navigationConfig, "/purchasing/landed-cost/new")).toEqual({
      permissions: ["landed-cost.create"],
      match: "any",
      source: "create-override",
    });
    expect(resolveRouteAccess(navigationConfig, "/sales/orders/new/").permissions).toEqual([
      "sales.orders.create",
    ]);
  });

  it.each([
    ["/purchasing/landed-cost/new", "landed-cost.create", "landed-cost.view"],
    [
      "/finance/journal-entries/new",
      "accounting.journal-entries.create",
      "accounting.journal-entries.view",
    ],
    ["/sales/orders/new", "sales.orders.create", "sales.orders.view"],
    ["/sales/quotations/new", "sales.quotations.create", "sales.quotations.view"],
    ["/sales/invoices/new", "sales.invoices.create", "sales.invoices.view"],
    ["/sales/payments/new", "sales.receipts.create", "sales.receipts.view"],
    ["/purchasing/payments/new", "purchasing.payments.create", "purchasing.payments.view"],
    ["/hr/employees/new", "hr.employees.create", "hr.employees.view"],
    [
      "/investors/opportunities/new",
      "investment-opportunities.create",
      "investment-opportunities.view",
    ],
  ])("%s — allowed with create only, denied with view only", (path, create, view) => {
    expect(allowed(path, create)).toBe(true);
    expect(allowed(path, view)).toBe(false);
    expect(allowed(path)).toBe(false);
  });

  it("detail routes still require the list's view permission", () => {
    expect(resolveRouteAccess(navigationConfig, "/purchasing/landed-cost/abc-123")).toEqual({
      permissions: ["landed-cost.view"],
      match: "all",
      source: "navigation",
    });
    expect(allowed("/sales/orders/8f2c", "sales.orders.create")).toBe(false);
    expect(allowed("/sales/orders/8f2c", "sales.orders.view")).toBe(true);
    // A record literally numbered like a route segment is still a detail route.
    expect(allowed("/sales/orders/newest", "sales.orders.create")).toBe(false);
  });

  it("leaves list, unknown and ungated routes unaffected", () => {
    expect(resolveRouteAccess(navigationConfig, "/sales/orders").permissions).toEqual([
      "sales.orders.view",
    ]);
    expect(resolveRouteAccess(navigationConfig, "/design-system")).toEqual({
      permissions: [],
      match: "all",
      source: "ungated",
    });
    expect(allowed("/design-system")).toBe(true);
    expect(allowed("/")).toBe(true);
  });
});
