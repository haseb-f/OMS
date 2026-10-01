import { describe, expect, it } from "vitest";
import { NAVIGATION_GROUPS, navigationConfig } from "./navigation.config";
import { filterNavigationByAuth } from "./build-navigation-tree";
import { isRouteAccessAllowed, resolveRouteAccess } from "./route-access";
import {
  homePathFor,
  resolvePostLoginPath,
  safeNextPath,
  startFreshNavigationSession,
} from "./post-login";
import { STORAGE_KEYS } from "../constants/storage-keys";
import ar from "../i18n/messages/ar";
import agentPortalAr from "../i18n/messages/modules/agent-portal.ar";
import agentPortalEn from "../i18n/messages/modules/agent-portal.en";

/** R6 workstream A — navigation regrouping, settings domains, landing. */

const byId = new Map(navigationConfig.map((item) => [item.id, item]));
const childrenOf = (parent: string) =>
  navigationConfig.filter((item) => item.parent === parent && item.visible !== false);
const visibleIds = (permissions: string[], userType: "INTERNAL" | "AGENT" = "INTERNAL") =>
  filterNavigationByAuth(navigationConfig, permissions, { accessReady: true, userType }).map(
    (item) => item.id,
  );
const canOpen = (route: string, permissions: string[], search?: string) =>
  isRouteAccessAllowed(resolveRouteAccess(navigationConfig, route, search), (p) =>
    permissions.includes(p),
  );

describe("R6 A.1 — Finance", () => {
  it("holds operational/accounting destinations only, under three headings", () => {
    const finance = childrenOf("finance");
    expect(new Set(finance.map((item) => item.group))).toEqual(
      new Set(["finance-operations", "finance-ledger", "finance-assets"]),
    );
    const ids = finance.map((item) => item.id);
    for (const moved of [
      "master-data-payment-methods",
      "master-data-currencies",
      "finance-fiscal-periods",
      "finance-accounting-settings",
      "finance-cost-allocation-rules",
    ]) {
      expect(ids).not.toContain(moved);
    }
    expect(ids).toContain("finance-fx");
    expect(byId.get("finance-fx")?.group).toBe("finance-ledger");
  });

  it("has no duplicate General Ledger link and hides the ComingSoon receiving accounts", () => {
    expect(byId.has("finance-general-ledger")).toBe(false);
    expect(byId.get("finance-receiving-accounts")?.visible).toBe(false);
    // The route itself still resolves (bookmarks keep working).
    expect(resolveRouteAccess(navigationConfig, "/finance/receiving-accounts").source).toBe(
      "ungated",
    );
  });

  it("labels incoming vs outgoing payments by their real purpose", () => {
    expect(byId.get("finance-payment-review")?.route).toBe("/finance/payment-review");
    expect(ar.nav.financePaymentReview).toBe("تحصيلات المتجر");
    expect(byId.get("finance-supplier-payments")?.route).toBe("/purchasing/payments");
    expect(ar.nav.financeSupplierPayments).toBe("مدفوعات الموردين");
    expect(ar.nav.financeBankTransactions).toBe("مطابقة العمليات");
  });
});

describe("R6 A.2/A.3 — Settings by domain", () => {
  it("every settings child sits under a settings-* heading and is route-gated", () => {
    const settings = childrenOf("settings");
    expect(settings.length).toBeGreaterThan(20);
    for (const item of settings) {
      expect(item.group?.startsWith("settings-"), item.id).toBe(true);
      expect(item.permissions?.length, item.id).toBeGreaterThan(0);
    }
    const groups = new Set(settings.map((item) => item.group));
    expect(groups).toEqual(
      new Set(Object.keys(NAVIGATION_GROUPS).filter((group) => group.startsWith("settings-"))),
    );
  });

  it("moves setup entries without changing any route", () => {
    expect(byId.get("master-data-shipping-companies")).toMatchObject({
      parent: "settings",
      group: "settings-shipping",
      route: "/master-data/shipping-companies",
    });
    expect(byId.get("expenses-components")).toMatchObject({
      parent: "settings",
      group: "settings-costs",
      route: "/expenses/cost-components",
    });
    expect(byId.get("master-data-workflow-transitions")?.group).toBe("settings-crm");
  });

  it("a domain view key opens exactly that domain's pages", () => {
    // The server expands settings.finance.view into the domain's view keys.
    const finance = [
      "settings.view",
      "settings.finance.view",
      "masterdata.payment-methods.view",
      "masterdata.taxes.view",
    ];
    expect(canOpen("/finance/fiscal-periods", finance)).toBe(true);
    expect(canOpen("/master-data/payment-methods", finance)).toBe(true);
    expect(canOpen("/master-data/shipping-companies", finance)).toBe(false);
    expect(canOpen("/settings/general", finance)).toBe(false);
    expect(canOpen("/settings/users", finance)).toBe(false);
    const ids = visibleIds(finance);
    expect(ids).toEqual(expect.arrayContaining(["settings", "finance-fiscal-periods"]));
    expect(ids).not.toContain("settings-integrations");
  });

  it("existing granular keys keep opening their pages (any-of)", () => {
    expect(canOpen("/finance/year-closing", ["accounting.fiscal-years.manage"])).toBe(true);
    expect(canOpen("/settings/document-numbering", ["numbering.manage"])).toBe(true);
    expect(canOpen("/settings/document-numbering", [])).toBe(false);
    expect(canOpen("/settings/integrations", ["settings.integrations.view"])).toBe(true);
  });

  it("agents never see internal settings, whatever they hold", () => {
    const ids = visibleIds(["settings.finance.manage", "masterdata.taxes.view"], "AGENT");
    expect(ids.some((id) => byId.get(id)?.parent === "settings" || id === "settings")).toBe(false);
  });
});

describe("R6 A.4 — landing and deep links", () => {
  it("lands on the authorized dashboard when next is missing or invalid", () => {
    expect(resolvePostLoginPath(null, "INTERNAL")).toBe("/");
    expect(resolvePostLoginPath(null, "AGENT")).toBe("/agent");
    expect(homePathFor(undefined)).toBe("/");
    for (const bad of [
      "//evil.example/x",
      "https://evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "/login?next=/x",
      "/reset-password",
      "/investor/dashboard",
      "relative/path",
    ]) {
      expect(resolvePostLoginPath(bad, "INTERNAL"), bad).toBe("/");
    }
    expect(safeNextPath("/a\u0000b", "INTERNAL")).toBeNull();
  });

  it("preserves a valid deep link including its query string", () => {
    expect(resolvePostLoginPath("/store-orders?status=NEW&page=2", "INTERNAL")).toBe(
      "/store-orders?status=NEW&page=2",
    );
    expect(resolvePostLoginPath("/agent/orders?tab=open#x", "AGENT")).toBe(
      "/agent/orders?tab=open#x",
    );
  });

  it("keeps each audience inside its own area", () => {
    expect(resolvePostLoginPath("/finance/expenses", "AGENT")).toBe("/agent");
    expect(resolvePostLoginPath("/agent/orders", "INTERNAL")).toBe("/");
    expect(resolvePostLoginPath("/profile/password", "AGENT")).toBe("/profile/password");
  });

  it("a fresh login forgets the previously expanded sidebar group", () => {
    const removed: string[] = [];
    startFreshNavigationSession({ removeItem: (key) => void removed.push(key) });
    expect(removed).toEqual([STORAGE_KEYS.sidebarExpandedSection]);
  });

  it("names the agent home «لوحة التحكم / Dashboard» in nav and page title", () => {
    expect(agentPortalAr.nav.dashboard).toBe("لوحة التحكم");
    expect(agentPortalAr.dashboard.title).toBe("لوحة التحكم");
    expect(agentPortalEn.nav.dashboard).toBe("Dashboard");
    expect(agentPortalEn.dashboard.title).toBe("Dashboard");
  });
});

/**
 * R6 A.6 — role-access matrix documented in specs/ui-navigation-r6/navigation-map.md.
 * OMS has no roles (per-user grants); these are representative grant sets
 * AFTER the R6 migration, already expanded the way `/auth/me` serves them
 * (`withSettingsDomainGrants` on the API).
 */
describe("R6 A.6 — role-access matrix", () => {
  const ROLES: Record<
    string,
    { userType: "INTERNAL" | "AGENT"; superAdmin?: boolean; grants: string[] }
  > = {
    admin: { userType: "INTERNAL", superAdmin: true, grants: [] },
    sales: {
      userType: "INTERNAL",
      grants: ["crm.leads.view", "store-orders.view", "partners.view", "sales.orders.view"],
    },
    shipping: {
      userType: "INTERNAL",
      grants: [
        "shipping.view",
        "shipping.edit",
        // migrated: holder of shipping master data → settings.shipping.view (+ expansion)
        "settings.view",
        "settings.shipping.view",
        "masterdata.shipping-companies.view",
        "masterdata.shipping-statuses.view",
        "masterdata.fulfillment-cost-rules.view",
      ],
    },
    finance: {
      userType: "INTERNAL",
      grants: [
        "accounting.journal-entries.view",
        "sales.receipts.view",
        "purchasing.payments.view",
        "accounting.fiscal-years.manage",
        // migrated: fiscal-years.manage holder → settings.finance.view (+ expansion)
        "settings.view",
        "settings.finance.view",
        "masterdata.payment-methods.view",
        "masterdata.payment-terms.view",
        "masterdata.payment-sources.view",
        "masterdata.currencies.view",
        "masterdata.taxes.view",
        "masterdata.journals.view",
        "masterdata.cost-allocation-rules.view",
        "masterdata.receiving-accounts.view",
      ],
    },
    agentAdmin: {
      userType: "AGENT",
      grants: [
        "agent.dashboard.view",
        "agent.leads.view",
        "agent.orders.view",
        "agent.stock.view",
        "agent.statement.view",
        "agent.payouts.view",
        "agent.team.view",
      ],
    },
    agentSales: {
      userType: "AGENT",
      grants: ["agent.dashboard.view", "agent.leads.view", "agent.orders.view"],
    },
  };

  const sections = (role: keyof typeof ROLES) => {
    const { userType, superAdmin, grants } = ROLES[role];
    const visible = filterNavigationByAuth(navigationConfig, grants, {
      accessReady: true,
      userType,
      isSuperAdmin: superAdmin,
    });
    const ids = new Set(visible.map((item) => item.id));
    const settingsGroups = new Set(
      visible
        .filter((item) => item.parent === "settings" && item.visible !== false)
        .map((item) => item.group),
    );
    return { ids, settingsGroups };
  };

  it("internal Admin sees Finance and every Settings domain", () => {
    const { ids, settingsGroups } = sections("admin");
    expect(ids.has("finance")).toBe(true);
    expect(settingsGroups.size).toBe(6);
    expect(ids.has("agent-portal-dashboard")).toBe(false);
  });

  it("internal Sales sees no Finance and no Settings", () => {
    const { ids } = sections("sales");
    expect(ids.has("crm")).toBe(true);
    expect(ids.has("finance")).toBe(false);
    expect(ids.has("settings")).toBe(false);
  });

  it("internal Shipping sees Settings → Shipping only", () => {
    const { ids, settingsGroups } = sections("shipping");
    expect(ids.has("shipping")).toBe(true);
    expect([...settingsGroups]).toEqual(["settings-shipping"]);
    expect(ids.has("finance")).toBe(false);
  });

  it("internal Finance sees Finance and Settings → Finance only", () => {
    const { ids, settingsGroups } = sections("finance");
    expect(ids.has("finance-payment-review")).toBe(true);
    expect(ids.has("finance-supplier-payments")).toBe(true);
    expect([...settingsGroups]).toEqual(["settings-finance"]);
    expect(ids.has("settings-users")).toBe(false);
  });

  it("Agent Admin / Agent Sales see only the portal, Dashboard first", () => {
    const admin = sections("agentAdmin").ids;
    const sales = sections("agentSales").ids;
    for (const ids of [admin, sales]) {
      expect([...ids].every((id) => byId.get(id)?.audience === "agent")).toBe(true);
      expect(ids.has("agent-portal-dashboard")).toBe(true);
    }
    expect(admin.has("agent-portal-statement")).toBe(true);
    expect(sales.has("agent-portal-statement")).toBe(false);
    expect(sales.has("agent-portal-team")).toBe(false);
  });
});
