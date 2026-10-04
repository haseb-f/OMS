import { describe, expect, it } from "vitest";
import { messages } from "@/i18n/messages";
import { translate } from "@/i18n/translate";
import { buildHomeTiles } from "./home-tiles";
import { buildNavigationTree, flattenNavigationTree } from "./build-navigation-tree";
import {
  buildModuleOverview,
  destinationDescriptionKey,
  isModuleEntry,
  type ModuleOverviewAccess,
  moduleOverviewPath,
  parseModuleOverviewPath,
} from "./module-overview";
import { NAVIGATION_GROUPS, navigationConfig } from "./navigation.config";
import { isRouteAccessAllowed, resolveRouteAccess } from "./route-access";

const internal = (permissions: string[] = [], isSuperAdmin = false): ModuleOverviewAccess => ({
  permissions,
  isSuperAdmin,
  userType: "INTERNAL",
});
const overview = (moduleId: string, access = internal([], true)) =>
  buildModuleOverview(navigationConfig, access, moduleId, NAVIGATION_GROUPS);
const destinationIds = (moduleId: string, access = internal([], true)) =>
  overview(moduleId, access)?.sections.flatMap((s) => s.destinations.map((d) => d.id)) ?? [];

describe("module overview paths", () => {
  it("round-trips a module id and rejects every other path", () => {
    expect(moduleOverviewPath("sales")).toBe("/modules/sales");
    expect(parseModuleOverviewPath("/modules/sales")).toBe("sales");
    expect(parseModuleOverviewPath("/modules/sales/")).toBe("sales");
    expect(parseModuleOverviewPath("/modules")).toBeNull();
    expect(parseModuleOverviewPath("/modules/sales/extra")).toBeNull();
    expect(parseModuleOverviewPath("/sales/orders")).toBeNull();
    expect(parseModuleOverviewPath("/modules/%E0%A4%A")).toBeNull();
  });
});

describe("Home tiles open an overview for modules and the page for page entries", () => {
  const tiles = buildHomeTiles(navigationConfig, internal([], true));
  it("every module tile → /modules/<id>; Dashboard stays a direct destination", () => {
    const roots = buildNavigationTree(navigationConfig).filter(
      (item) => !item.homeHidden && item.audience !== "agent",
    );
    for (const root of roots) {
      const tile = tiles.find((entry) => entry.id === root.id);
      expect(tile, root.id).toBeTruthy();
      expect(tile?.href).toBe(isModuleEntry(root) ? `/modules/${root.id}` : root.route);
    }
    expect(tiles.find((tile) => tile.id === "dashboard")?.href).toBe("/dashboard");
  });

  it("a module with ONE authorized page still opens its overview", () => {
    const single = [
      { id: "m", titleKey: "nav.sales", icon: "users", order: 1 },
      { id: "m-a", parent: "m", titleKey: "nav.sales", route: "/m/a", permissions: ["m.a.view"] },
      { id: "m-b", parent: "m", titleKey: "nav.sales", route: "/m/b", permissions: ["m.b.view"] },
    ] as unknown as typeof navigationConfig;
    const access = internal(["m.a.view"]);
    const tile = buildHomeTiles(single, access).find((entry) => entry.id === "m");
    expect(tile?.href).toBe("/modules/m");
    const model = buildModuleOverview(single, access, "m", NAVIGATION_GROUPS);
    expect(model?.sections.flatMap((section) => section.destinations.map((d) => d.id))).toEqual([
      "m-a",
    ]);
  });
});

describe("buildModuleOverview", () => {
  it("lists only what the user may open, in the sidebar's order", () => {
    const access = internal(["sales.orders.view", "sales.invoices.view"]);
    const ids = destinationIds("sales", access);
    expect(ids).toEqual(expect.arrayContaining(["sales-orders", "sales-invoices"]));
    expect(ids).not.toContain("sales-quotations");
    expect(ids).not.toContain("sales-customers");
  });

  it("every listed destination passes the route guard's own rule for that user", () => {
    for (const access of [
      internal(["sales.orders.view", "partners.view", "store-orders.view"]),
      internal(["accounting.journal-entries.view", "finance.view"]),
      internal(["crm.leads.view"]),
    ]) {
      const held = (permission: string) => access.permissions.includes(permission);
      for (const root of buildHomeTiles(navigationConfig, access)) {
        const model = overview(root.id, access);
        for (const destination of model?.sections.flatMap((s) => s.destinations) ?? []) {
          const requirement = resolveRouteAccess(navigationConfig, destination.route);
          expect(isRouteAccessAllowed(requirement, held), `${root.id} → ${destination.route}`).toBe(
            true,
          );
        }
      }
    }
  });

  it("is null for an unknown module, a page entry, a hidden Home and a module with nothing authorized", () => {
    expect(overview("no-such-module")).toBeNull();
    expect(overview("dashboard")).toBeNull();
    expect(overview("home")).toBeNull();
    expect(overview("finance", internal([]))).toBeNull();
    expect(overview("settings", internal(["crm.leads.view"]))).toBeNull();
  });

  it("never offers the agent portal to staff, nor staff modules to an agent", () => {
    expect(overview("agent-portal-orders")).toBeNull();
    const agent = {
      permissions: ["agent.orders.view"],
      isSuperAdmin: false,
      userType: "AGENT" as const,
    };
    expect(overview("sales", agent)).toBeNull();
    expect(overview("finance", agent)).toBeNull();
  });

  it("orders ungrouped pages first, then each group by its order", () => {
    const model = overview("finance");
    const groups = model?.sections.map((section) => section.groupId) ?? [];
    expect(groups.indexOf(null)).toBeLessThanOrEqual(0);
    const orders = groups.filter(Boolean).map((group) => NAVIGATION_GROUPS[group!].order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});

describe("destination descriptions", () => {
  const leaves = flattenNavigationTree(buildNavigationTree(navigationConfig))
    .filter((item) => item.route && item.audience !== "agent")
    .filter((item) => item.id !== "home" && item.id !== "dashboard");
  const moduleRoots = buildNavigationTree(navigationConfig).filter(isModuleEntry);
  const listed = new Set(
    moduleRoots.flatMap((root) =>
      flattenNavigationTree(root.children ?? [])
        .filter((item) => item.route)
        .map((item) => item.id),
    ),
  );

  it("every destination a module overview can list has an English and an Arabic line", () => {
    expect(listed.size).toBeGreaterThan(80);
    for (const id of listed) {
      for (const locale of ["en", "ar"] as const) {
        const key = destinationDescriptionKey(id);
        const text = translate(messages[locale], key);
        expect(text, `${locale} ${id}`).not.toBe(key);
        expect(text.trim().length, `${locale} ${id}`).toBeGreaterThan(8);
      }
    }
    expect(leaves.length).toBeGreaterThan(0);
  });
});
