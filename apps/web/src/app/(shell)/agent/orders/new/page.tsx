"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { PageLoading } from "@/components/shared/page-loading";
import { ErrorState } from "@/components/shared/error-state";
import { OrderEntryFlow, useOrderEntryFlow } from "@/components/order-entry/order-entry-flow";
import { useAgentOrderEntry } from "@/components/order-entry/agent/use-agent-order-entry";
import { portalAgentEntrySource } from "@/components/order-entry/agent/agent-entry-source";
import { usePortalProfile } from "@/components/agent-portal/use-portal-profile";
import {
  agentPortalService,
  type CountryRef,
  type CurrencyRef,
  type FulfillmentMethod,
  type PortalLead,
} from "@/services/agent-portal-service";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useLocale } from "@/providers/locale-provider";
import { apiErrorMessage } from "@/lib/toast";

/**
 * New agent order, or — with `?leadId=` — the conversion of one of the
 * agent's leads (customer from the lead, pricing entered here): the agent
 * adapter of the one order-entry flow (R15 D15-19), as a page. Route access:
 * `agent.orders.create` (reviewed create override); conversion additionally
 * needs `agent.leads.convert`, which the API enforces.
 */
export default function AgentNewOrderPage() {
  const { t } = useLocale();
  const params = useSearchParams();
  const leadId = params.get("leadId");
  const methodParam = params.get("method");
  const { profile, countries, loading } = usePortalProfile();
  const [lead, setLead] = useState<PortalLead | null>(null);
  const [leadError, setLeadError] = useState<string | null>(null);

  useBreadcrumbLabel(lead ? lead.leadNumber : null);

  useEffect(() => {
    if (!leadId) return;
    agentPortalService.leads
      .get(leadId)
      .then(setLead)
      .catch((error) => setLeadError(apiErrorMessage(error, "agentPortal.common.loadFailed")));
  }, [leadId]);

  const title = lead
    ? t("agentPortal.orderForm.convertTitle", { number: lead.leadNumber })
    : t("agentPortal.orderForm.title");

  if (leadError) return <ErrorState description={leadError} />;
  if (loading || (leadId && !lead)) return <PageLoading />;

  return (
    <PageWorkspace title={title} description={t("agentPortal.orderForm.description")}>
      <AgentPortalOrderEntry
        lead={lead}
        initialMethod={
          methodParam === "PICKUP" || methodParam === "SHIPPING"
            ? methodParam
            : (lead?.fulfillmentMethod ?? "SHIPPING")
        }
        countries={countries}
        currency={profile?.agent.currency ?? null}
      />
    </PageWorkspace>
  );
}

function AgentPortalOrderEntry({
  lead,
  initialMethod,
  countries,
  currency,
}: {
  lead: PortalLead | null;
  initialMethod: FulfillmentMethod;
  countries: Array<CountryRef & { code: string }>;
  currency: CurrencyRef | null;
}) {
  const router = useRouter();
  const flow = useOrderEntryFlow(true);
  const adapter = useAgentOrderEntry({
    source: portalAgentEntrySource,
    open: true,
    lead,
    onOpenLead: lead ? () => router.push(`/agent/leads/${lead.id}`) : undefined,
    initialMethod,
    countries,
    currency,
    flow,
    onCreated: (created) => router.push(`/agent/orders/${created.id}`),
    onCancel: () => router.back(),
  });
  return (
    <OrderEntryFlow
      flow={flow}
      adapter={adapter}
      container="page"
      onCancel={() => router.back()}
      testId="agent-order-entry"
    />
  );
}
