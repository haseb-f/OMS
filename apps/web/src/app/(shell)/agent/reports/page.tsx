"use client";

import { PageWorkspace } from "@/components/shared/page-workspace";
import { PermissionGate } from "@/components/shared/permission-gate";
import { SalesReportsView } from "@/components/reports/sales-reports-view";
import { useLocale } from "@/providers/locale-provider";

/**
 * Agent portal — sales reports (R13 spec E) over
 * `GET /agent-portal/sales-reports/*`: with `agent.reports.view_team` the
 * agent's whole team, anyone else their own figures and own rank (R15
 * D15-18 — `agent.records.view_all` never widens figures). No company cost
 * or margin, and never another agent.
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
