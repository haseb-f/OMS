import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";
import type { AudienceUserType } from "../types/navigation";
import { filterNavigationByAuth, flattenNavigationTree } from "./build-navigation-tree";
import { buildModuleOverview, destinationDescriptionKey } from "./module-overview";
import { NAVIGATION_GROUPS, navigationConfig } from "./navigation.config";
import {
  isRouteAccessAllowed,
  resolveNavigationItemForRoute,
  resolveRouteAccess,
  routeAudienceMismatch,
} from "./route-access";

/**
 * R16 S2 — the agent experience is split into an Overview (summaries,
 * metrics, reporting) and Management (table, search, create, edit), on the
 * existing navigation and permissions, per persona.
 */
type Persona = { userType: AudienceUserType; permissions: string[]; isSuperAdmin?: boolean };

const PERSONAS: Record<string, Persona> = {
  companyAdmin: {
    userType: "INTERNAL",
    permissions: ["agents.view", "agents.create", "agents.edit", "agents.finance.view"],
  },
  companyViewer: { userType: "INTERNAL", permissions: ["agents.view"] },
  companyOther: { userType: "INTERNAL", permissions: ["store-orders.view"] },
  agentAdmin: {
    userType: "AGENT",
    permissions: [
      "agent.dashboard.view",
      "agent.team.view",
      "agent.orders.view",
      "agent.statement.view",
      "agents.view",
    ],
  },
  agentSales: {
    userType: "AGENT",
    permissions: ["agent.dashboard.view", "agent.orders.view", "agent.leads.view"],
  },
};

const visibleIds = (persona: Persona) =>
  flattenNavigationTree(
    filterNavigationByAuth(navigationConfig, persona.permissions, {
      accessReady: true,
      isSuperAdmin: persona.isSuperAdmin,
      userType: persona.userType,
    }),
  ).map((item) => item.id);

const canOpen = (persona: Persona, route: string) =>
  routeAudienceMismatch(persona.userType, route) === null &&
  isRouteAccessAllowed(resolveRouteAccess(navigationConfig, route), (key) =>
    persona.permissions.includes(key),
  );

const AGENT_ID = "6f1c3a52-2b8e-4a4e-9a51-0d6c1f2b9e11";

describe("company agents: overview and management are two destinations", () => {
  it("registers /agents/overview as its own entry, before management, on agents.view", () => {
    const overview = navigationConfig.find((item) => item.id === "agents-overview");
    const management = navigationConfig.find((item) => item.id === "agents-list");
    expect(overview).toMatchObject({
      parent: "agents",
      route: "/agents/overview",
      permissions: ["agents.view"],
    });
    expect(management).toMatchObject({ parent: "agents", route: "/agents" });
    expect(overview!.order!).toBeLessThan(management!.order!);
  });

  it("resolves overview, management and agent detail routes to the right owner", () => {
    expect(resolveNavigationItemForRoute(navigationConfig, "/agents/overview")?.id).toBe(
      "agents-overview",
    );
    expect(resolveNavigationItemForRoute(navigationConfig, "/agents")?.id).toBe("agents-list");
    // An agent's own page stays under management (its tabs are unchanged).
    expect(resolveNavigationItemForRoute(navigationConfig, `/agents/${AGENT_ID}`)?.id).toBe(
      "agents-list",
    );
  });

  it("is a real route of its own — never served by agents/[id] with id «overview»", () => {
    const shell = resolve(process.cwd(), "src/app/(shell)/agents");
    expect(existsSync(resolve(shell, "overview/page.tsx"))).toBe(true);
    const page = readFileSync(resolve(shell, "overview/page.tsx"), "utf8");
    expect(page).toMatch(/permission="agents\.view"/);
  });

  it("management keeps the table and create, and no longer duplicates the overview", () => {
    const management = readFileSync(
      resolve(process.cwd(), "src/app/(shell)/agents/page.tsx"),
      "utf8",
    );
    expect(management).toMatch(/EnterpriseDataTable/);
    expect(management).toMatch(/AgentFormDialog/);
    // No overview panel (PageWorkspace `secondary={<…>}`) and no overview figures.
    expect(management).not.toMatch(/AgentsOverview|agentOverviewApi|secondary=\{</);
    const overview = readFileSync(
      resolve(process.cwd(), "src/components/agents/overview/agents-overview.tsx"),
      "utf8",
    );
    expect(overview).not.toMatch(
      /EnterpriseDataTable|AgentFormDialog|agentsService\.(create|update)/,
    );
  });

  it("company admin: both destinations visible and openable, collections with finance", () => {
    const persona = PERSONAS.companyAdmin;
    expect(visibleIds(persona)).toEqual(
      expect.arrayContaining(["agents-overview", "agents-list", "agents-collections"]),
    );
    expect(canOpen(persona, "/agents/overview")).toBe(true);
    expect(canOpen(persona, "/agents")).toBe(true);
    expect(canOpen(persona, `/agents/${AGENT_ID}`)).toBe(true);
  });

  it("agents.view alone: overview and management, never collections", () => {
    const ids = visibleIds(PERSONAS.companyViewer);
    expect(ids).toEqual(expect.arrayContaining(["agents-overview", "agents-list"]));
    expect(ids).not.toContain("agents-collections");
  });

  it("a company user without agents.view sees and opens neither", () => {
    const persona = PERSONAS.companyOther;
    const ids = visibleIds(persona);
    expect(ids).not.toContain("agents-overview");
    expect(ids).not.toContain("agents-list");
    expect(canOpen(persona, "/agents/overview")).toBe(false);
    expect(canOpen(persona, "/agents")).toBe(false);
  });

  it("the module overview lists Overview then Management, only when authorized", () => {
    const destinations = (persona: Persona) =>
      buildModuleOverview(
        navigationConfig,
        {
          permissions: persona.permissions,
          isSuperAdmin: false,
          userType: persona.userType,
        },
        "agents",
        NAVIGATION_GROUPS,
      )?.sections.flatMap((section) => section.destinations.map((d) => d.id)) ?? [];
    expect(destinations(PERSONAS.companyAdmin)).toEqual([
      "agents-overview",
      "agents-list",
      "agents-collections",
    ]);
    expect(destinations(PERSONAS.companyOther)).toEqual([]);
    expect(destinations(PERSONAS.agentAdmin)).toEqual([]);
  });

  it("names the two destinations distinctly and describes each on Home (ar + en)", () => {
    for (const locale of ["ar", "en"] as const) {
      const t = (key: MessageKey) => translate(messages[locale], key);
      expect(t("agents.nav.overview")).not.toBe(t("agents.nav.list"));
      expect(t("agents.nav.overview")).not.toBe("agents.nav.overview");
      for (const id of ["agents-overview", "agents-list"]) {
        const key = destinationDescriptionKey(id);
        expect(translate(messages[locale], key), `${locale} ${key}`).not.toBe(key);
      }
    }
    expect(translate(messages.ar, "agents.nav.list")).toBe("إدارة الوكلاء");
    expect(translate(messages.en, "agents.nav.list")).toBe("Agent management");
  });
});

describe("agent portal: overview (dashboard) vs team management", () => {
  it("agent admin: dashboard and team management, never the company agent pages", () => {
    const persona = PERSONAS.agentAdmin;
    const ids = visibleIds(persona);
    expect(ids).toEqual(expect.arrayContaining(["agent-portal-dashboard", "agent-portal-team"]));
    expect(ids).not.toContain("agents-overview");
    expect(ids).not.toContain("agents-list");
    expect(canOpen(persona, "/agent/dashboard")).toBe(true);
    expect(canOpen(persona, "/agent/team")).toBe(true);
    // Even holding a company-looking key, an agent never reaches /agents/*.
    expect(canOpen(persona, "/agents/overview")).toBe(false);
    expect(canOpen(persona, "/agents")).toBe(false);
  });

  it("agent sales employee: own dashboard only — no team management", () => {
    const persona = PERSONAS.agentSales;
    const ids = visibleIds(persona);
    expect(ids).toContain("agent-portal-dashboard");
    expect(ids).not.toContain("agent-portal-team");
    expect(canOpen(persona, "/agent/dashboard")).toBe(true);
    expect(canOpen(persona, "/agent/team")).toBe(false);
    expect(canOpen(persona, "/agents/overview")).toBe(false);
  });

  it("the team page reads as management next to the dashboard (ar + en)", () => {
    expect(translate(messages.ar, "agentPortal.nav.team")).toBe("إدارة الفريق");
    expect(translate(messages.en, "agentPortal.nav.team")).toBe("Team management");
    expect(translate(messages.ar, "agentPortal.nav.dashboard")).not.toBe(
      translate(messages.ar, "agentPortal.nav.team"),
    );
  });
});
