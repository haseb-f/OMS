"use client";

import { useCallback } from "react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { AgentCommissionReportView } from "@/components/agents/agent-commission-report";
import { agentPortalService } from "@/services/agent-portal-service";
import { useLocale } from "@/providers/locale-provider";

/** Agent portal — item-level commission and shipping recovery (commission-policy.md A7); no carrier cost (spec 2E). */
export default function AgentCommissionPage() {
  const { t } = useLocale();
  const load = useCallback(
    (params: { from?: string; to?: string }) => agentPortalService.commissionReport(params),
    [],
  );
  const orderHref = useCallback((storeOrderId: string) => `/agent/orders/${storeOrderId}`, []);
  return (
    <PageWorkspace
      dense
      title={t("agents.commission.report.title")}
      description={t("agentPricing.report.portalDescription")}
    >
      <AgentCommissionReportView
        load={load}
        orderHref={orderHref}
        exportName="commission-report.csv"
      />
    </PageWorkspace>
  );
}
