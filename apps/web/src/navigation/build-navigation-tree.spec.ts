import { describe, expect, it } from "vitest";
import {
  buildNavigationTree,
  filterNavigationByAuth,
  flattenNavigationTree,
} from "./build-navigation-tree";
import type { NavigationItem } from "../types/navigation";

/**
 * Regression: the Command Palette used to build its item list from the raw
 * `navigationConfig` directly — `flattenNavigationTree(buildNavigationTree(config))`
 * with no `filterNavigationByAuth` step — so it offered every destination to
 * every user regardless of permission, unlike the Sidebar which always
 * filtered first. This drives the exact same composition the fixed
 * `CommandPalette` uses, so a regression there fails here too.
 */
const config: NavigationItem[] = [
  { id: "dashboard", titleKey: "nav.dashboard", route: "/", order: 0 },
  {
    id: "finance",
    titleKey: "nav.finance",
    order: 10,
    permissions: ["finance.view"],
  },
  {
    id: "finance-journal-entries",
    titleKey: "nav.financeJournalEntries",
    parent: "finance",
    route: "/finance/journal-entries",
    order: 1,
    permissions: ["accounting.journal-entries.view"],
  },
  {
    id: "crm",
    titleKey: "nav.crm",
    order: 20,
    permissions: ["crm.view"],
  },
  {
    id: "crm-leads",
    titleKey: "nav.crmLeads",
    parent: "crm",
    route: "/crm/leads",
    order: 1,
    permissions: ["crm.leads.view"],
  },
];

function paletteItems(userPermissions: string[], opts: { isSuperAdmin?: boolean } = {}) {
  return flattenNavigationTree(
    buildNavigationTree(
      filterNavigationByAuth(config, userPermissions, {
        isSuperAdmin: opts.isSuperAdmin,
        accessReady: true,
      }),
    ),
  ).filter((item) => item.route);
}

describe("Command Palette navigation composition (filter -> build -> flatten)", () => {
  it("a Sales Agent (crm.leads.view only) sees Leads but not Journal Entries", () => {
    const routes = paletteItems(["crm.leads.view"]).map((i) => i.route);
    expect(routes).toContain("/crm/leads");
    expect(routes).not.toContain("/finance/journal-entries");
  });

  it("a Finance user sees Journal Entries but not Leads", () => {
    const routes = paletteItems(["finance.view", "accounting.journal-entries.view"]).map(
      (i) => i.route,
    );
    expect(routes).toContain("/finance/journal-entries");
    expect(routes).not.toContain("/crm/leads");
  });

  it("a user with no permissions sees only the ungated Dashboard route", () => {
    const routes = paletteItems([]);
    expect(routes.map((i) => i.route)).toEqual(["/"]);
  });

  it("a super admin sees every route regardless of granted permissions", () => {
    const routes = paletteItems([], { isSuperAdmin: true }).map((i) => i.route);
    expect(routes).toContain("/crm/leads");
    expect(routes).toContain("/finance/journal-entries");
  });

  it("while access is not yet ready, filtering is skipped (never a false negative during bootstrap)", () => {
    const routes = flattenNavigationTree(
      buildNavigationTree(filterNavigationByAuth(config, [], { accessReady: false })),
    )
      .filter((item) => item.route)
      .map((i) => i.route);
    expect(routes).toContain("/crm/leads");
    expect(routes).toContain("/finance/journal-entries");
  });
});
