"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { PageLoading } from "@/components/shared/page-loading";
import { ErrorState } from "@/components/shared/error-state";
import { usePortalProfile } from "@/components/agent-portal/use-portal-profile";
import { useCountries } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import {
  agentPortalService,
  type CurrencyRef,
  type FulfillmentMethod,
  type PortalLead,
} from "@/services/agent-portal-service";
import { apiErrorMessage } from "@/lib/toast";
import { ORDER_ENTRY_DIALOG_CLASS, OrderEntryFlow, useOrderEntryFlow } from "../order-entry-flow";
import type { EntryCountryOption } from "../entry-fields";
import {
  portalAgentEntrySource,
  staffAgentEntrySource,
  type AgentEntryResult,
  type AgentEntrySource,
} from "./agent-entry-source";
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

/** A fulfilment method from a deep link (`?method=`), or null when it is not one. */
export function fulfillmentMethodParam(value: string | null | undefined): FulfillmentMethod | null {
  return value === "PICKUP" || value === "SHIPPING" ? value : null;
}

/**
 * The agent adapter of the one order-entry flow in the shared compact dialog
 * (R15 D15-19, R16 S3) — every agent entry point (portal new order, lead
 * conversion, company staff entering an agent order) renders exactly this.
 * Mounted per open, so every order starts from a clean form with its own
 * idempotency key.
 */
function AgentOrderEntryFlowDialog({
  source,
  lead = null,
  onOpenLead,
  initialMethod,
  countries,
  currency,
  title,
  description,
  testId,
  onClose,
  onCreated,
}: {
  source: AgentEntrySource;
  lead?: PortalLead | null;
  onOpenLead?: () => void;
  initialMethod?: FulfillmentMethod;
  countries: readonly EntryCountryOption[];
  currency: CurrencyRef | null;
  title: string;
  description: string;
  testId: string;
  onClose: () => void;
  /** The order exists: the caller closes the dialog and / or navigates (never both through `onClose`). */
  onCreated: (result: AgentEntryResult) => void;
}) {
  const flow = useOrderEntryFlow(true);
  const adapter = useAgentOrderEntry({
    source,
    open: true,
    lead,
    onOpenLead,
    initialMethod,
    countries,
    currency,
    flow,
    onCreated,
    onCancel: onClose,
  });
  return (
    <OrderEntryFlow
      flow={flow}
      adapter={adapter}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      description={description}
      testId={testId}
    />
  );
}

/**
 * Agent portal (agent admin / agent sales employee): a new order, or — with
 * `leadId` — the conversion of one of the agent's leads (customer from the
 * lead, pricing entered here). Loads the portal profile (settlement currency,
 * destination countries) and the lead first, inside the same compact dialog
 * shell. Access: `agent.orders.create`; conversion also needs
 * `agent.leads.convert`, which the API enforces.
 */
export function AgentPortalOrderEntryDialog({
  leadId = null,
  method = null,
  onClose,
  onCreated,
  onOpenLead,
}: {
  leadId?: string | null;
  /** The fulfilment method to start with (a lead's own method otherwise; shipping by default). */
  method?: FulfillmentMethod | null;
  onClose: () => void;
  /** The order exists: the caller closes the dialog and / or opens the order. */
  onCreated: (result: AgentEntryResult) => void;
  /** "Open lead" from the lead's customer summary; defaults to the lead's page. */
  onOpenLead?: (leadId: string) => void;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const { profile, countries, loading } = usePortalProfile();
  const [lead, setLead] = useState<PortalLead | null>(null);
  const [leadError, setLeadError] = useState<string | null>(null);

  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    agentPortalService.leads
      .get(leadId)
      .then((row) => {
        if (!cancelled) setLead(row);
      })
      .catch((error) => {
        if (!cancelled) setLeadError(apiErrorMessage(error, "agentPortal.common.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  const title = lead
    ? t("agentPortal.orderForm.convertTitle", { number: lead.leadNumber })
    : t("agentPortal.orderForm.title");
  const description = t("agentPortal.orderForm.description");
  const testId = "agent-order-entry";

  if (leadError || loading || (leadId && !lead)) {
    // The same compact shell while the profile / lead load (or fail) — no layout jump.
    return (
      <EnterpriseModal
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        size="lg"
        className={ORDER_ENTRY_DIALOG_CLASS}
        title={title}
        description={description}
        testId={testId}
      >
        {leadError ? <ErrorState description={leadError} /> : <PageLoading />}
      </EnterpriseModal>
    );
  }

  return (
    <AgentOrderEntryFlowDialog
      source={portalAgentEntrySource}
      lead={lead}
      onOpenLead={
        lead
          ? () => (onOpenLead ? onOpenLead(lead.id) : router.push(`/agent/leads/${lead.id}`))
          : undefined
      }
      initialMethod={method ?? lead?.fulfillmentMethod ?? "SHIPPING"}
      countries={countries}
      currency={profile?.agent.currency ?? null}
      title={title}
      description={description}
      testId={testId}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}

/**
 * Company staff entering an order for one agent (spec 1.9): the agent adapter
 * over the internal `/agent-orders` endpoints, the agent's catalog and an
 * owner among the agent's users.
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
  return (
    <AgentOrderEntryFlowDialog
      source={source}
      countries={countries}
      currency={agent.currency}
      title={t("orderEntry.agent.staffTitle", { agent: agent.name })}
      description={t("orderEntry.agent.staffDescription")}
      testId="agent-order-entry-dialog"
      onClose={onClose}
      onCreated={(result) => {
        onClose();
        onCreated?.(result);
      }}
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
