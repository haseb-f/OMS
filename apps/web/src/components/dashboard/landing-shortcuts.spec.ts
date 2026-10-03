import { describe, expect, it } from "vitest";
import { buildLandingShortcuts } from "./landing-shortcuts";
import type { NavigationItem } from "@/types/navigation";

const nav: NavigationItem[] = [
  { id: "dashboard", titleKey: "nav.dashboard", route: "/", order: 0 },
  { id: "shipping", titleKey: "nav.crm", order: 20, permissions: ["shipping.view"] },
  {
    id: "shipping-list",
    titleKey: "nav.crm",
    route: "/shipping/list",
    parent: "shipping",
    order: 1,
    permissions: ["shipping.view"],
  },
  {
    id: "shipping-status",
    titleKey: "nav.crm",
    route: "/shipping/status",
    parent: "shipping",
    order: 2,
    permissions: ["shipping.view"],
  },
  { id: "crm", titleKey: "nav.crm", order: 10, permissions: ["crm.view"] },
  {
    id: "crm-leads",
    titleKey: "nav.crm",
    route: "/crm/leads",
    parent: "crm",
    order: 1,
    permissions: ["crm.leads.view"],
  },
  {
    id: "agent-home",
    titleKey: "nav.crm",
    route: "/agent",
    audience: "agent",
    order: 1,
  },
];

const base = { navigation: nav, isSuperAdmin: false, pinnedIds: [], recentIds: [] };

describe("buildLandingShortcuts (no empty landing)", () => {
  it("suggests the first page of each module the user may open, in module order", () => {
    const result = buildLandingShortcuts({
      ...base,
      permissions: ["shipping.view", "crm.view", "crm.leads.view"],
    });
    expect(result.personal).toEqual([]);
    expect(result.suggested.map((item) => item.id)).toEqual(["crm-leads", "shipping-list"]);
  });

  it("never offers pages outside the user's permissions or audience", () => {
    const result = buildLandingShortcuts({ ...base, permissions: ["shipping.view"] });
    expect(result.suggested.map((item) => item.id)).toEqual(["shipping-list"]);
  });

  it("prefers the user's own pinned and recent pages", () => {
    const result = buildLandingShortcuts({
      ...base,
      permissions: ["shipping.view"],
      pinnedIds: ["shipping-status"],
      recentIds: ["shipping-status", "crm-leads", "dashboard"],
    });
    expect(result.personal.map((item) => item.id)).toEqual(["shipping-status"]);
    expect(result.suggested).toEqual([]);
  });

  it("returns nothing for a user with no module access (the page says so)", () => {
    expect(buildLandingShortcuts({ ...base, permissions: [] })).toEqual({
      personal: [],
      suggested: [],
    });
  });
});
