import { describe, expect, it } from "vitest";
import type { NavigationItem } from "../types/navigation";
import { filterNavigationByAuth } from "./build-navigation-tree";
import { routeAudienceMismatch } from "./route-access";

/** Agents milestone (spec §3) — shared shell, separate audiences. */
describe("agent audience separation", () => {
  const items: NavigationItem[] = [
    { id: "dashboard", titleKey: "nav.dashboard" as never, route: "/" },
    {
      id: "store-orders",
      titleKey: "nav.dashboard" as never,
      route: "/store-orders",
      permissions: ["store-orders.view"],
    },
    {
      id: "agent-home",
      titleKey: "nav.dashboard" as never,
      route: "/agent",
      audience: "agent",
      permissions: ["agent.dashboard.view"],
    },
  ];

  it("shows agent users only agent items", () => {
    const ids = filterNavigationByAuth(items, ["agent.dashboard.view", "store-orders.view"], {
      accessReady: true,
      userType: "AGENT",
    }).map((i) => i.id);
    expect(ids).toEqual(["agent-home"]);
  });

  it("never shows portal items to internal users, even a super admin", () => {
    const ids = filterNavigationByAuth(items, [], {
      accessReady: true,
      isSuperAdmin: true,
      userType: "INTERNAL",
    }).map((i) => i.id);
    expect(ids).toEqual(["dashboard", "store-orders"]);
  });

  it("keeps agents inside /agent and internal users out of it", () => {
    expect(routeAudienceMismatch("AGENT", "/agent")).toBeNull();
    expect(routeAudienceMismatch("AGENT", "/agent/orders/1")).toBeNull();
    expect(routeAudienceMismatch("AGENT", "/")).toBe("agent-outside-portal");
    expect(routeAudienceMismatch("AGENT", "/store-orders")).toBe("agent-outside-portal");
    expect(routeAudienceMismatch("AGENT", "/agents")).toBe("agent-outside-portal");
    expect(routeAudienceMismatch("INTERNAL", "/agent/orders")).toBe("internal-in-portal");
    expect(routeAudienceMismatch("INTERNAL", "/agents/123")).toBeNull();
    expect(routeAudienceMismatch(undefined, "/store-orders")).toBeNull();
  });
});
