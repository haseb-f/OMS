"use client";

import { useEffect, useMemo, useState } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  analyticAccountsColumns,
  analyticAccountsStaticFields,
  analyticAccountsSchema,
  analyticAccountsDefaultValues,
  analyticAccountsExportColumns,
  analyticAccountRowLabel,
  type AnalyticAccountRow,
  type AnalyticPlanRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<AnalyticAccountRow>("/analytic-accounts");
const plansService = createMasterDataService<AnalyticPlanRow>("/analytic-plans");

export default function AnalyticAccountsPage() {
  const [plans, setPlans] = useState<AnalyticPlanRow[]>([]);
  const [accounts, setAccounts] = useState<AnalyticAccountRow[]>([]);

  useEffect(() => {
    plansService
      .list({ pageSize: 200 })
      .then((result) => setPlans(result.items))
      .catch(() => setPlans([]));
    service
      .list({ pageSize: 500 })
      .then((result) => setAccounts(result.items))
      .catch(() => setAccounts([]));
  }, []);

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      {
        name: "analyticPlanId",
        label: "masterData.fields.analyticPlan",
        type: "select",
        required: true,
        options: plans.map((plan) => ({ value: plan.id, label: plan.name })),
      },
      {
        name: "parentAccountId",
        label: "masterData.fields.parentAccount",
        type: "select",
        options: accounts.map((account) => ({ value: account.id, label: account.name })),
      },
      ...analyticAccountsStaticFields,
    ],
    [plans, accounts],
  );

  return (
    <MasterDataPage
      titleKey="masterData.analyticAccounts.title"
      descriptionKey="masterData.analyticAccounts.description"
      tableId="analytic-accounts"
      service={service}
      columns={analyticAccountsColumns}
      exportColumnKeys={analyticAccountsExportColumns}
      formFields={formFields}
      schema={analyticAccountsSchema}
      defaultValues={analyticAccountsDefaultValues}
      permissionPrefix="masterdata.analytic-accounts"
      rowLabel={analyticAccountRowLabel}
    />
  );
}
