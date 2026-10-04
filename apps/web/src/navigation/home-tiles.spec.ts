import { describe, expect, it } from "vitest";
import { navigationConfig } from "./navigation.config";
import { CREATE_ROUTE_PERMISSIONS, resolveRouteAccess } from "./route-access";
import { HOME_ACTIONS, HOME_TONE_CYCLE, buildHomeActions, buildHomeTiles } from "./home-tiles";
import { filterNavigationByAuth, flattenNavigationTree } from "./build-navigation-tree";

const internal = (permissions: string[], isSuperAdmin = false) => ({
  permissions,
  isSuperAdmin,
  userType: "INTERNAL" as const,
});
const agent = (permissions: string[]) => ({
  permissions,
  isSuperAdmin: false,
  userType: "AGENT" as const,
});

const ids = (tiles: { id: string }[]) => tiles.map((tile) => tile.id);

describe("buildHomeTiles — company users", () => {
  it("never lists Home itself", () => {
    expect(ids(buildHomeTiles(navigationConfig, internal([], true)))).not.toContain("home");
  });

  it("shows the Dashboard first and every module for a super admin", () => {
    const tiles = buildHomeTiles(navigationConfig, internal([], true));
    expect(tiles[0].id).toBe("dashboard");
    expect(tiles[0].href).toBe("/dashboard");
    expect(ids(tiles)).toEqual(expect.arrayContaining(["crm", "sales", "finance", "settings"]));
    // Agent portal items are never offered to staff.
    expect(ids(tiles).some((id) => id.startsWith("agent-portal"))).toBe(false);
  });

  it("offers only the module a sales-only user may open, at its overview", () => {
    const tiles = buildHomeTiles(navigationConfig, internal(["crm.leads.view"]));
    expect(ids(tiles)).toContain("crm");
    expect(ids(tiles)).not.toContain("finance");
    expect(ids(tiles)).not.toContain("settings");
    // A module opens its overview, never its first page — even with one authorized page.
    expect(tiles.find((tile) => tile.id === "crm")?.href).toBe("/modules/crm");
  });

  it("never lists a page the user cannot open inside a tile", () => {
    const tiles = buildHomeTiles(navigationConfig, internal(["crm.leads.view"]));
    const crm = tiles.find((tile) => tile.id === "crm");
    // Sales Teams needs `crm.sales-teams.view` — absent, so it is not previewed.
    expect(crm?.previewKeys).not.toContain("nav.crmSalesTeams");
  });

  it("derives tiles from the sidebar's own filter (no second permission rule)", () => {
    const permissions = ["crm.leads.view", "sales.orders.view", "partners.view"];
    const tiles = buildHomeTiles(navigationConfig, internal(permissions));
    const visibleRoots = filterNavigationByAuth(navigationConfig, permissions, {
      accessReady: true,
      userType: "INTERNAL",
    }).filter((item) => !item.parent && !item.homeHidden);
    // Every tile is a sidebar module the same user sees…
    for (const tile of tiles) expect(visibleRoots.map((item) => item.id)).toContain(tile.id);
    // …and every tile's destination passes the route guard's own rule (a module's overview is
    // ungated itself; each page it lists is checked in module-overview.spec.ts).
    for (const tile of tiles.filter((entry) => !entry.href.startsWith("/modules/"))) {
      const access = resolveRouteAccess(navigationConfig, tile.href);
      const ok =
        access.permissions.length === 0 ||
        (access.match === "any"
          ? access.permissions.some((p) => permissions.includes(p))
          : access.permissions.every((p) => permissions.includes(p)));
      expect(ok, `${tile.id} → ${tile.href}`).toBe(true);
    }
  });

  it("keeps a tile's colour stable: declared tone, else a fixed palette slot", () => {
    const tiles = buildHomeTiles(navigationConfig, internal([], true));
    const palette: readonly string[] = [...HOME_TONE_CYCLE, "slate"];
    for (const tile of tiles) expect(palette).toContain(tile.tone);
    expect(buildHomeTiles(navigationConfig, internal([], true))).toEqual(tiles);
  });

  it("shows no gated module to a user holding no permissions", () => {
    const tiles = buildHomeTiles(navigationConfig, internal([]));
    expect(ids(tiles)).not.toContain("finance");
    expect(ids(tiles)).not.toContain("crm");
  });
});

describe("buildHomeTiles — agent portal", () => {
  const adminPermissions = [
    "agent.dashboard.view",
    "agent.leads.view",
    "agent.orders.view",
    "agent.stock.view",
    "agent.statement.view",
    "agent.payouts.view",
    "agent.team.view",
  ];
  const salesPermissions = [
    "agent.dashboard.view",
    "agent.leads.view",
    "agent.orders.view",
    "agent.orders.create",
  ];

  it("lists portal pages only, Agent Admin more than Agent Sales", () => {
    const admin = ids(buildHomeTiles(navigationConfig, agent(adminPermissions)));
    const sales = ids(buildHomeTiles(navigationConfig, agent(salesPermissions)));
    expect(admin).toEqual(
      expect.arrayContaining([
        "agent-portal-dashboard",
        "agent-portal-orders",
        "agent-portal-payouts",
        "agent-portal-team",
      ]),
    );
    expect(sales).toEqual(["agent-portal-dashboard", "agent-portal-leads", "agent-portal-orders"]);
    expect(admin.every((id) => id.startsWith("agent-portal"))).toBe(true);
    expect(admin).not.toContain("agent-portal-home");
  });

  it("opens the agent dashboard at its own route, not the portal home", () => {
    const tiles = buildHomeTiles(navigationConfig, agent(adminPermissions));
    expect(tiles.find((tile) => tile.id === "agent-portal-dashboard")?.href).toBe(
      "/agent/dashboard",
    );
  });
});

describe("buildHomeActions", () => {
  it("only offers actions whose create route the user holds", () => {
    const actions = buildHomeActions(navigationConfig, internal(["sales.orders.create"]));
    expect(actions.map((action) => action.id)).toEqual(["new-order"]);
  });

  it("hides every action from a user without create rights", () => {
    expect(buildHomeActions(navigationConfig, internal(["sales.orders.view"]))).toEqual([]);
  });

  it("never offers staff actions to agents or agent actions to staff", () => {
    const staff = buildHomeActions(navigationConfig, internal([], true)).map((a) => a.id);
    expect(staff).not.toContain("new-agent-order");
    const agentActions = buildHomeActions(navigationConfig, agent(["agent.orders.create"])).map(
      (a) => a.id,
    );
    expect(agentActions).toEqual(["new-agent-order"]);
  });

  it("every action's route has a reviewed create permission", () => {
    for (const action of HOME_ACTIONS) {
      expect(CREATE_ROUTE_PERMISSIONS[action.route], action.route).toBeDefined();
    }
  });
});

describe("navigation config — Home and Dashboard", () => {
  it("puts Home before the Dashboard, both audiences", () => {
    const rank = (id: string) => navigationConfig.find((item) => item.id === id)?.order ?? 0;
    expect(rank("home")).toBeLessThan(rank("dashboard"));
    expect(rank("agent-portal-home")).toBeLessThan(rank("agent-portal-dashboard"));
  });

  it("keeps every route unique", () => {
    const routes = flattenNavigationTree(navigationConfig)
      .map((item) => item.route)
      .filter(Boolean);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
