"use client";

import { Handshake } from "lucide-react";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";

/**
 * Portal identity in the shell's context slot (where internal users see the
 * company switcher): the agent's name and number, so an agent user always
 * knows which account the portal is showing. Renders nothing for anyone else.
 */
export function AgentPortalIdentity() {
  const { t } = useLocale();
  const { user } = useUserContext();
  const agent = user?.userType === "AGENT" ? user.agent : null;
  if (!agent) return null;

  return (
    <div
      className="flex h-10 w-full items-center gap-2 rounded-sm border border-sidebar-border bg-card px-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:px-0"
      title={`${agent.name} · ${agent.agentNumber}`}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-xs bg-primary-soft text-primary">
        <Handshake className="size-3.5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-start justify-center text-start leading-tight group-data-[collapsible=icon]:hidden">
        <span className="w-full truncate text-caption font-semibold text-sidebar-foreground">
          {agent.name}
        </span>
        <span className="w-full truncate text-micro text-sidebar-muted-foreground">
          {t("agentPortal.identity.portal")} ·{" "}
          <span className="num" dir="ltr">
            {agent.agentNumber}
          </span>
        </span>
      </span>
    </div>
  );
}
