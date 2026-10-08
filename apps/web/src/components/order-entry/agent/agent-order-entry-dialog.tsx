"use client";

import { useMemo, useState } from "react";
import { ShoppingCart } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { useCountries } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import type { CurrencyRef } from "@/services/agent-portal-service";
import { OrderEntryFlow, useOrderEntryFlow } from "../order-entry-flow";
import { staffAgentEntrySource, type AgentEntryResult } from "./agent-entry-source";
import { useAgentOrderEntry } from "./use-agent-order-entry";

export interface AgentEntryTarget {
  id: string;
  name: string;
  currency: CurrencyRef | null;
}

/** Company staff may enter an agent's order with `agents.edit`, or `store-orders.create` + `agents.view` (the API's rule). */
export function canEnterAgentOrder(hasPermission: (name: string) => boolean): boolean {
  return (
    hasPermission("agents.edit") ||
    (hasPermission("store-orders.create") && hasPermission("agents.view"))
  );
}

/**
 * Company staff entering an order for one agent (spec 1.9): the agent adapter
 * of the one order-entry flow over the internal `/agent-orders` endpoints, the
 * agent's catalog and an owner among the agent's users. Mounted per open, so
 * every order starts from a clean form with its own idempotency key.
 */
function AgentOrderEntryDialog({
  agent,
  onClose,
  onCreated,
}: {
  agent: AgentEntryTarget;
  onClose: () => void;
  onCreated?: (result: AgentEntryResult) => void;
}) {
  const { t } = useLocale();
  const countries = useCountries();
  const source = useMemo(() => staffAgentEntrySource(agent.id), [agent.id]);
  const flow = useOrderEntryFlow(true);
  const adapter = useAgentOrderEntry({
    source,
    open: true,
    countries,
    currency: agent.currency,
    flow,
    onCreated: (result) => {
      onClose();
      onCreated?.(result);
    },
    onCancel: onClose,
  });
  return (
    <OrderEntryFlow
      flow={flow}
      adapter={adapter}
      container="dialog"
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("orderEntry.agent.staffTitle", { agent: agent.name })}
      description={t("orderEntry.agent.staffDescription")}
      testId="agent-order-entry-dialog"
    />
  );
}

/** "New agent order" — shown only to staff who may enter one. */
export function AgentOrderEntryButton({
  agent,
  onCreated,
}: {
  agent: AgentEntryTarget;
  onCreated?: (result: AgentEntryResult) => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const [open, setOpen] = useState(false);
  if (!canEnterAgentOrder(hasPermission)) return null;
  return (
    <>
      <EnterpriseButton type="button" size="xs" variant="ghost" onClick={() => setOpen(true)}>
        <ShoppingCart data-icon="inline-start" />
        {t("orderEntry.agent.newOrder")}
      </EnterpriseButton>
      {open ? (
        <AgentOrderEntryDialog agent={agent} onClose={() => setOpen(false)} onCreated={onCreated} />
      ) : null}
    </>
  );
}
