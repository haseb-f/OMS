"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { PageWorkspace } from "@/components/shared/page-workspace";
import {
  AgentPortalOrderEntryDialog,
  fulfillmentMethodParam,
} from "@/components/order-entry/agent/agent-order-entry-dialog";
import { AGENT_PORTAL_HOME } from "@/navigation/route-access";
import { useLocale } from "@/providers/locale-provider";

/**
 * Deep link to a new agent order (`?leadId=` converts one of the agent's
 * leads, `?method=PICKUP|SHIPPING` starts with that method) — Home tile,
 * dashboard shortcut, "convert" links in toasts. It opens the same compact
 * order-entry dialog the lists open in place (R16 S3), never a full-page
 * form. Closing returns to where the user came from; a created order opens
 * its detail (replacing this URL, so Back never reopens the form). Route
 * access: `agent.orders.create`.
 */
export default function AgentNewOrderPage() {
  const { t } = useLocale();
  const router = useRouter();
  const params = useSearchParams();

  const leave = () => {
    if (window.history.length > 1) router.back();
    else router.replace(AGENT_PORTAL_HOME);
  };

  return (
    <PageWorkspace title={t("agentPortal.orderForm.title")}>
      <AgentPortalOrderEntryDialog
        leadId={params.get("leadId")}
        method={fulfillmentMethodParam(params.get("method"))}
        onClose={leave}
        onCreated={(created) => router.replace(`/agent/orders/${created.id}`)}
      />
    </PageWorkspace>
  );
}
