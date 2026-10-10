"use client";

import { Handshake } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { PermissionGate } from "@/components/shared/permission-gate";
import { AgentsOverview } from "@/components/agents/overview/agents-overview";
import { useLocale } from "@/providers/locale-provider";

/**
 * Agents overview (R16 S2, `agents.view`): the cross-agent summaries, metrics
 * and per-agent figures — read-only. The agent table, search / filters,
 * create and edit live on Agent management (`/agents`); this page only links
 * there. A static segment, so it wins over `agents/[id]` («overview» is never
 * read as an agent id).
 */
export default function AgentsOverviewPage() {
  return (
    <PermissionGate permission="agents.view">
      <AgentsOverviewContent />
    </PermissionGate>
  );
}

function AgentsOverviewContent() {
  const { t } = useLocale();
  return (
    <PageWorkspace
      title={t("agentOverview.agents.title")}
      description={t("agentOverview.agents.description")}
      actions={
        <HeaderActions
          secondary={[
            {
              key: "manage",
              label: t("agents.nav.list"),
              icon: Handshake,
              href: "/agents",
            },
          ]}
        />
      }
    >
      <AgentsOverview />
    </PageWorkspace>
  );
}
