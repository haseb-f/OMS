"use client";

import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { PermissionGate } from "@/components/shared/permission-gate";
import { useLocale } from "@/providers/locale-provider";
import { AgingTab } from "../finance/aging-tab";
import { PartnerStatementTab } from "../finance/partner-statement-tab";

const PARTY = {
  CUSTOMER: {
    side: "AR",
    titleKey: "nav.reportsCustomers",
    descriptionKey: "reports.categories.customers",
    agingKey: "reports.finance.arAging",
    statementKey: "reports.finance.customerStatement",
  },
  SUPPLIER: {
    side: "AP",
    titleKey: "nav.reportsSuppliers",
    descriptionKey: "reports.categories.suppliers",
    agingKey: "reports.finance.apAging",
    statementKey: "reports.finance.supplierStatement",
  },
} as const;

/**
 * `/reports/customers` and `/reports/suppliers` — one page for either party
 * type: its aging and its statement. A statement link (`?partner=<id>`,
 * e.g. from the partner's page) opens straight on the statement tab.
 */
function PartnerReportsContent({ role }: { role: keyof typeof PARTY }) {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const party = PARTY[role];
  return (
    <PageWorkspace title={t(party.titleKey)} description={t(party.descriptionKey)}>
      <Tabs defaultValue={searchParams.get("partner") ? "statement" : "aging"}>
        <TabsList variant="line" className="flex-wrap">
          <TabsTrigger value="aging">{t(party.agingKey)}</TabsTrigger>
          <TabsTrigger value="statement">{t(party.statementKey)}</TabsTrigger>
        </TabsList>
        <TabsContent value="aging">
          <AgingTab side={party.side} />
        </TabsContent>
        <TabsContent value="statement">
          <PartnerStatementTab role={role} />
        </TabsContent>
      </Tabs>
    </PageWorkspace>
  );
}

export function PartnerReportsPage({ role }: { role: keyof typeof PARTY }) {
  return (
    <PermissionGate permission="reports.financial.view">
      <PartnerReportsContent role={role} />
    </PermissionGate>
  );
}
