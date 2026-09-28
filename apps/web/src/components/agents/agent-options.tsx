"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SelectFilter } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/business/status-badge";
import { agentsService, type AgentRow } from "@/services/agents-service";
import { cachedLookup } from "@/lib/lookup-cache";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";

/** Every agent (active and inactive) for filters and pickers — only when the user may list agents. */
export function useAgentOptions(): { agents: AgentRow[]; canList: boolean } {
  const { hasPermission } = useUserContext();
  const canList = hasPermission("agents.view");
  const [agents, setAgents] = useState<AgentRow[]>([]);

  useEffect(() => {
    if (!canList) return;
    let cancelled = false;
    cachedLookup("agents:options", () => agentsService.list({ pageSize: 200 }))
      .then((result) => {
        if (!cancelled) setAgents(result.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [canList]);

  return { agents, canList };
}

export function agentOptionLabel(agent: { agentNumber: string; name: string }): string {
  return `${agent.name} · ${agent.agentNumber}`;
}

/** List filter "Agent" — hidden for users who cannot list agents. */
export function AgentFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLocale();
  const { agents, canList } = useAgentOptions();
  if (!canList) return null;
  return (
    <SelectFilter
      label={t("agents.storeOrder.filter")}
      value={value}
      onChange={onChange}
      searchable
      options={agents.map((agent) => ({
        value: agent.id,
        label: agentOptionLabel(agent),
        searchText: agent.agentNumber,
      }))}
    />
  );
}

/** Owner-agent badge for store-order / shipping rows; links to the agent workspace when permitted. */
export function AgentBadge({
  agent,
}: {
  agent: { id: string; name: string; agentNumber: string } | null | undefined;
}) {
  const { hasPermission } = useUserContext();
  if (!agent) return <span className="text-muted-foreground">—</span>;
  const badge = <StatusBadge label={agentOptionLabel(agent)} tone="info" />;
  return hasPermission("agents.view") ? (
    <Link href={`/agents/${agent.id}`} className="inline-flex max-w-full min-w-0 hover:underline">
      {badge}
    </Link>
  ) : (
    badge
  );
}
