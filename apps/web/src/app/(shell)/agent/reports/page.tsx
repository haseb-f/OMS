"use client";

import { PageWorkspace } from "@/components/shared/page-workspace";
import { PermissionGate } from "@/components/shared/permission-gate";
import { SalesReportsView } from "@/components/reports/sales-reports-view";
import { useLocale } from "@/providers/locale-provider";

/**
 * Agent portal — sales reports (R13 spec E) over
 * `GET /agent-portal/sales-reports/*`: an agent admin with view-all sees the
 * agent's orders, a sales user their own. No company cost or margin, and
 * never another agent.
 */
export default function AgentSalesReportsPage() {
  const { t } = useLocale();
  return (
    <PermissionGate permission="agent.dashboard.view">
      <PageWorkspace title={t("salesReports.agentTitle")}>
        <SalesReportsView source="agent" />
      </PageWorkspace>
    </PermissionGate>
  );
}
