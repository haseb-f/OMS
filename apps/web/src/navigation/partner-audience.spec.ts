import { describe, expect, it } from "vitest";
import { buildNavigationTree, filterNavigationByAuth } from "./build-navigation-tree";
import { buildHomeActions, buildHomeTiles } from "./home-tiles";
import { buildModuleOverview } from "./module-overview";
import { NAVIGATION_GROUPS, navigationConfig } from "./navigation.config";
import { homePathFor } from "./post-login";
import { isRouteAccessAllowed, resolveRouteAccess, routeAudienceMismatch } from "./route-access";

const PARTNER_KEYS = ["partner.dashboard.view", "partner.statement.view"];

/** R15 (D15-14, 4.1-4.2, 4.11) — the partners section and the partner audience. */
describe("«الشركاء» — its own section with a Home tile", () => {
  const internal = (permissions: string[], isSuperAdmin = false) => ({
    permissions,
    isSuperAdmin,
    userType: "INTERNAL" as const,
  });

  it("is a top-level section (not under Finance) with its own tone and an icon no other section uses", () => {
    const roots = buildNavigationTree(navigationConfig);
    const section = roots.find((item) => item.id === "company-partners");
    expect(section).toMatchObject({ homeTone: "violet", icon: "briefcase" });
    expect(section?.parent).toBeUndefined();
    expect(
      roots.filter((item) => item.id !== "company-partners" && item.icon === "briefcase"),
    ).toEqual([]);
    expect(section?.children?.map((child) => child.id)).toEqual([
      "company-partners-list",
      "company-partners-periods",
    ]);
  });

  it("shows the Home tile — opening the module overview — only to company-partners.view holders", () => {
    const tile = buildHomeTiles(navigationConfig, internal(["company-partners.view"])).find(
      (entry) => entry.id === "company-partners",
    );
    expect(tile).toMatchObject({ href: "/modules/company-partners", tone: "violet" });
    expect(
      buildHomeTiles(
        navigationConfig,
        internal(["finance.view", "accounting.journal-entries.view"]),
      ).some((entry) => entry.id === "company-partners"),
    ).toBe(false);
    const overview = buildModuleOverview(
      navigationConfig,
      internal(["company-partners.view"]),
      "company-partners",
      NAVIGATION_GROUPS,
    );
    expect(overview?.sections.flatMap((s) => s.destinations.map((d) => d.route))).toEqual([
      "/company-partners",
      "/company-partners/periods",
    ]);
  });

  it("guards the partner pages by company-partners.view (list, periods, a partner's page)", () => {
    for (const route of [
      "/company-partners",
      "/company-partners/periods",
      "/company-partners/abc",
    ]) {
      const requirement = resolveRouteAccess(navigationConfig, route);
      expect(isRouteAccessAllowed(requirement, (key) => key === "company-partners.view")).toBe(
        true,
      );
      expect(isRouteAccessAllowed(requirement, (key) => key === "finance.view")).toBe(false);
    }
  });
});

describe("partner audience (a company partner's own login)", () => {
  it("sees only the partner portal entries — never a staff or agent page", () => {
    const ids = filterNavigationByAuth(navigationConfig, PARTNER_KEYS, {
      accessReady: true,
      userType: "PARTNER",
    }).map((item) => item.id);
    expect(ids.sort()).toEqual(
      ["partner-portal-home", "partner-portal-overview", "partner-portal-statement"].sort(),
    );
  });

  it("is never shown to staff (even a super admin) or to agents", () => {
    const staff = filterNavigationByAuth(navigationConfig, [], {
      accessReady: true,
      isSuperAdmin: true,
      userType: "INTERNAL",
    });
    const agent = filterNavigationByAuth(navigationConfig, ["agent.dashboard.view"], {
      accessReady: true,
      userType: "AGENT",
    });
    for (const list of [staff, agent]) {
      expect(list.some((item) => item.audience === "partner")).toBe(false);
    }
  });

  it("Home = its own tiles (Overview, Statement), each at its own route, per permission; no staff actions", () => {
    const access = { permissions: PARTNER_KEYS, isSuperAdmin: false, userType: "PARTNER" as const };
    expect(buildHomeTiles(navigationConfig, access).map((tile) => [tile.id, tile.href])).toEqual([
      ["partner-portal-overview", "/partner/overview"],
      ["partner-portal-statement", "/partner/statement"],
    ]);
    expect(
      buildHomeTiles(navigationConfig, { ...access, permissions: ["partner.statement.view"] }).map(
        (tile) => tile.id,
      ),
    ).toEqual(["partner-portal-statement"]);
    expect(buildHomeActions(navigationConfig, access)).toEqual([]);
  });

  it("keeps a partner inside /partner (plus own profile) and everyone else out of it", () => {
    expect(routeAudienceMismatch("PARTNER", "/partner")).toBeNull();
    expect(routeAudienceMismatch("PARTNER", "/partner/statement")).toBeNull();
    expect(routeAudienceMismatch("PARTNER", "/profile/password")).toBeNull();
    for (const route of ["/", "/dashboard", "/company-partners", "/agent", "/modules/finance"]) {
      expect(routeAudienceMismatch("PARTNER", route)).toBe("partner-outside-portal");
    }
    expect(routeAudienceMismatch("INTERNAL", "/partner")).toBe("internal-in-portal");
    expect(routeAudienceMismatch("INTERNAL", "/partner/overview")).toBe("internal-in-portal");
    expect(routeAudienceMismatch("INTERNAL", "/partners-report")).toBeNull();
    expect(routeAudienceMismatch("AGENT", "/partner")).toBe("agent-outside-portal");
    expect(homePathFor("PARTNER")).toBe("/partner");
  });

  it("gates each portal page by the partner.* key its API requires", () => {
    const allowed = (route: string, keys: string[]) =>
      isRouteAccessAllowed(resolveRouteAccess(navigationConfig, route), (key) =>
        keys.includes(key),
      );
    expect(allowed("/partner/overview", ["partner.dashboard.view"])).toBe(true);
    expect(allowed("/partner/overview", ["partner.statement.view"])).toBe(false);
    expect(allowed("/partner/statement", ["partner.statement.view"])).toBe(true);
    expect(allowed("/partner/statement", ["partner.dashboard.view"])).toBe(false);
    expect(allowed("/partner", [])).toBe(true);
  });
});
