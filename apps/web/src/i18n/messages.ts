import en from "./messages/en";
import ar from "./messages/ar";
import agentsEn from "./messages/modules/agents.en";
import agentsAr from "./messages/modules/agents.ar";
import agentPortalEn from "./messages/modules/agent-portal.en";
import agentPortalAr from "./messages/modules/agent-portal.ar";
import accountEn from "./messages/modules/account.en";
import accountAr from "./messages/modules/account.ar";
import insightsEn from "./messages/modules/insights.en";
import insightsAr from "./messages/modules/insights.ar";
import type { Locale } from "./locales";

/** Widens literal string leaves (from each dictionary's `as const`) to `string`, so any locale's own translated text satisfies the shape. */
type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };

/**
 * Agents milestone — the permission catalog (API `permission-catalog.ts`)
 * names the agent sections/modules `permissions.sections.agents|agentPortal`
 * and `permissions.modules.agents|agentUsers|agentFinance|agentPortal`. Their
 * text lives in the `agents` module files and is merged into the central
 * `permissions` namespace here, so the Permission Matrix resolves the
 * catalog's own keys.
 */
function withAgentCatalogLabels<
  D extends typeof en | typeof ar,
  A extends typeof agentsEn | typeof agentsAr,
>(dictionary: D, agents: A) {
  return {
    ...dictionary.permissions,
    sections: { ...dictionary.permissions.sections, ...agents.permissionLabels.sections },
    modules: { ...dictionary.permissions.modules, ...agents.permissionLabels.modules },
  };
}

/** Agents milestone — the `agents` / `agentPortal` namespaces live in their own module files. */
const enAll = {
  ...en,
  permissions: withAgentCatalogLabels(en, agentsEn),
  agents: agentsEn,
  agentPortal: agentPortalEn,
  account: accountEn,
  insights: insightsEn,
};

export type Messages = Widen<typeof enAll>;

/** `ar` must satisfy the same key shape as `en` — a missing key is a type error, not a silent fallback. */
const typedAr: Messages = {
  ...ar,
  permissions: withAgentCatalogLabels(ar, agentsAr),
  agents: agentsAr,
  agentPortal: agentPortalAr,
  account: accountAr,
  insights: insightsAr,
};

export const messages: Record<Locale, Messages> = { en: enAll, ar: typedAr };
