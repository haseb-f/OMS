"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { useLocale } from "@/providers/locale-provider";
import { PermissionGate } from "@/components/shared/permission-gate";
import { AgingTab } from "../finance/aging-tab";
import { PartnerStatementTab } from "../finance/partner-statement-tab";

function ReportsSuppliersPageContent() {
  const { t } = useLocale();
  return (
    <PageWorkspace
      title={t("nav.reportsSuppliers")}
      description={t("reports.categories.suppliers")}
    >
      <Tabs defaultValue="aging">
        <TabsList variant="line" className="flex-wrap">
          <TabsTrigger value="aging">{t("reports.finance.apAging")}</TabsTrigger>
          <TabsTrigger value="statement">{t("reports.finance.supplierStatement")}</TabsTrigger>
        </TabsList>
        <TabsContent value="aging">
          <AgingTab side="AP" />
        </TabsContent>
        <TabsContent value="statement">
          <PartnerStatementTab role="SUPPLIER" />
        </TabsContent>
      </Tabs>
    </PageWorkspace>
  );
}

export default function ReportsSuppliersPage() {
  return (
    <PermissionGate permission="reports.financial.view">
      <ReportsSuppliersPageContent />
    </PermissionGate>
  );
}
