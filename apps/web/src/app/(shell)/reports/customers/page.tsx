"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/providers/locale-provider";
import { PermissionGate } from "@/components/shared/permission-gate";
import { AgingTab } from "../finance/aging-tab";
import { PartnerStatementTab } from "../finance/partner-statement-tab";

function ReportsCustomersPageContent() {
  const { t } = useLocale();
  // A statement link (`?partner=<id>`, e.g. from the partner's page) opens
  // straight on the statement tab.
  const searchParams = useSearchParams();
  return (
    <PageWorkspace
      title={t("nav.reportsCustomers")}
      description={t("reports.categories.customers")}
    >
      <Tabs defaultValue={searchParams.get("partner") ? "statement" : "aging"}>
        <TabsList variant="line" className="flex-wrap">
          <TabsTrigger value="aging">{t("reports.finance.arAging")}</TabsTrigger>
          <TabsTrigger value="statement">{t("reports.finance.customerStatement")}</TabsTrigger>
        </TabsList>
        <TabsContent value="aging">
          <AgingTab side="AR" />
        </TabsContent>
        <TabsContent value="statement">
          <PartnerStatementTab role="CUSTOMER" />
        </TabsContent>
      </Tabs>
    </PageWorkspace>
  );
}

export default function ReportsCustomersPage() {
  return (
    <PermissionGate permission="reports.financial.view">
      <ReportsCustomersPageContent />
    </PermissionGate>
  );
}
