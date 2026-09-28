import { describe, expect, it } from "vitest";
import { messages } from "@/i18n/messages";
import { translate } from "@/i18n/translate";
import {
  AGENT_CATALOG_LABEL_KEYS,
  AGENT_PORTAL_PERMISSIONS,
  AGENT_ROLE_PRESETS,
  agentPermissionLabelKey,
  extraPermissionChoices,
  isAgentPortalPermission,
} from "./agent-permissions";

describe("agent permissions", () => {
  it("presets are subsets of the agent vocabulary; admin extends sales", () => {
    for (const role of ["ADMIN", "SALES"] as const) {
      expect(AGENT_ROLE_PRESETS[role].every(isAgentPortalPermission)).toBe(true);
    }
    expect(AGENT_ROLE_PRESETS.ADMIN).toEqual(expect.arrayContaining(AGENT_ROLE_PRESETS.SALES));
    // Team management is never part of a preset — it is delegated explicitly.
    expect(AGENT_ROLE_PRESETS.ADMIN).not.toContain("agent.team.manage");
  });

  it("extra choices are exactly what the preset does not grant", () => {
    expect(extraPermissionChoices("ADMIN")).toEqual([
      "agent.orders.override_shipping",
      "agent.team.manage",
    ]);
    expect(extraPermissionChoices("SALES")).toHaveLength(
      AGENT_PORTAL_PERMISSIONS.length - AGENT_ROLE_PRESETS.SALES.length,
    );
  });

  it("every agent permission and catalog label resolves in both languages", () => {
    for (const locale of ["en", "ar"] as const) {
      for (const name of AGENT_PORTAL_PERMISSIONS) {
        const key = agentPermissionLabelKey(name);
        expect(translate(messages[locale], key)).not.toBe(key);
      }
      for (const key of AGENT_CATALOG_LABEL_KEYS) {
        expect(translate(messages[locale], key)).not.toBe(key);
      }
    }
    expect(agentPermissionLabelKey("agent.orders.override_shipping")).toBe(
      "agents.permissionLabels.actions.orders_override_shipping",
    );
  });
});
