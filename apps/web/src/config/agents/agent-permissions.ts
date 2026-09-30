import type { MessageKey } from "@/i18n/translate";
import type { AgentRole } from "@/services/agents-service";

/**
 * The `agent.*` vocabulary and role presets — mirrors
 * `apps/api/src/permissions/permission-catalog.ts` (spec §3). The server is
 * the authority: it rejects any permission outside this set for agent users.
 */
export const AGENT_PORTAL_PERMISSIONS = [
  "agent.dashboard.view",
  "agent.leads.view",
  "agent.leads.create",
  "agent.leads.convert",
  "agent.orders.view",
  "agent.orders.create",
  "agent.orders.edit",
  "agent.orders.override_shipping",
  "agent.payments.declare",
  "agent.records.view_all",
  "agent.stock.view",
  "agent.statement.view",
  "agent.payouts.view",
  "agent.team.view",
  "agent.team.manage",
] as const;

export type AgentPortalPermission = (typeof AGENT_PORTAL_PERMISSIONS)[number];

const SALES_PRESET: AgentPortalPermission[] = [
  "agent.dashboard.view",
  "agent.leads.view",
  "agent.leads.create",
  "agent.leads.convert",
  "agent.orders.view",
  "agent.orders.create",
  "agent.orders.edit",
  "agent.payments.declare",
];

export const AGENT_ROLE_PRESETS: Record<AgentRole, AgentPortalPermission[]> = {
  SALES: SALES_PRESET,
  ADMIN: [
    ...SALES_PRESET,
    "agent.records.view_all",
    "agent.stock.view",
    "agent.statement.view",
    "agent.payouts.view",
    "agent.team.view",
  ],
};

export function isAgentPortalPermission(name: string): name is AgentPortalPermission {
  return (AGENT_PORTAL_PERMISSIONS as readonly string[]).includes(name);
}

/** i18n key of an `agent.*` permission (dots become underscores: `agent.team.manage` → `team_manage`). */
export function agentPermissionLabelKey(name: string): MessageKey {
  return `agents.permissionLabels.actions.${name.replace(/^agent\./, "").replace(/\./g, "_")}` as MessageKey;
}

/** Permissions a role does not grant by itself — the "additional" choices when creating a user. */
export function extraPermissionChoices(role: AgentRole): AgentPortalPermission[] {
  const preset = new Set(AGENT_ROLE_PRESETS[role]);
  return AGENT_PORTAL_PERMISSIONS.filter((name) => !preset.has(name));
}

/** The API catalog keys of the agent sections/modules — merged into `permissions.*` by `i18n/messages.ts`. */
export const AGENT_CATALOG_LABEL_KEYS: MessageKey[] = [
  "permissions.sections.agents",
  "permissions.sections.agentPortal",
  "permissions.modules.agents",
  "permissions.modules.agentUsers",
  "permissions.modules.agentFinance",
  "permissions.modules.agentPortal",
];

/** The Permission Matrix section holding the `agent.*` permissions. */
export const AGENT_PORTAL_SECTION_KEY = "agent-portal";
