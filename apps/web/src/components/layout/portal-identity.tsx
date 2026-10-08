"use client";

import { Briefcase, Handshake } from "lucide-react";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";

/**
 * Portal identity in the shell's context slot (where internal users see the
 * company switcher): the agent's or the company partner's name and number, so
 * an external user always knows which account the portal is showing. Renders
 * nothing for internal users.
 */
export function PortalIdentity() {
  const { t } = useLocale();
  const { user } = useUserContext();
  const identity =
    user?.userType === "AGENT" && user.agent
      ? {
          name: user.agent.name,
          number: user.agent.agentNumber,
          portal: t("agentPortal.identity.portal"),
          Icon: Handshake,
        }
      : user?.userType === "PARTNER" && user.companyPartner
        ? {
            name: user.companyPartner.name,
            number: user.companyPartner.partnerNumber,
            portal: t("partnerPortal.identity.portal"),
            Icon: Briefcase,
          }
        : null;
  if (!identity) return null;
  const { Icon } = identity;

  return (
    <div
      className="flex h-10 w-full items-center gap-2 rounded-sm border border-sidebar-border bg-card px-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:px-0"
      title={`${identity.name} · ${identity.number}`}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-xs bg-primary-soft text-primary">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-start justify-center text-start leading-tight group-data-[collapsible=icon]:hidden">
        <span className="w-full truncate text-caption font-semibold text-sidebar-foreground">
          {identity.name}
        </span>
        <span className="w-full truncate text-micro text-sidebar-muted-foreground">
          {identity.portal} ·{" "}
          <span className="num" dir="ltr">
            {identity.number}
          </span>
        </span>
      </span>
    </div>
  );
}
