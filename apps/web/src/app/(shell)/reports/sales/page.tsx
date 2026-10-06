"use client";

import { PageWorkspace } from "@/components/shared/page-workspace";
import { PermissionGate } from "@/components/shared/permission-gate";
import { SalesReportsView } from "@/components/reports/sales-reports-view";
import { useLocale } from "@/providers/locale-provider";

/**
 * Sales reports (R13 spec E): Live / Employees / Teams / Comparison /
 * Payment mix over `GET /sales-reports/*`. The page is gated on
 * `reports.sales.view`; the figures stay inside the viewer's sales scope
 * (own / team / all), enforced by the API.
 */
export default function ReportsSalesPage() {
  const { t } = useLocale();
  return (
    <PermissionGate permission="reports.sales.view">
      <PageWorkspace title={t("salesReports.title")}>
        <SalesReportsView source="company" />
      </PageWorkspace>
    </PermissionGate>
  );
}
