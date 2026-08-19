"use client";

import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import {
  analyticPlansColumns,
  analyticPlansFormFields,
  analyticPlansSchema,
  analyticPlansDefaultValues,
  analyticPlansExportColumns,
  analyticPlanRowLabel,
  type AnalyticPlanRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<AnalyticPlanRow>("/analytic-plans");

export default function AnalyticPlansPage() {
  return (
    <MasterDataPage
      titleKey="masterData.analyticPlans.title"
      descriptionKey="masterData.analyticPlans.description"
      breadcrumbKeys={["nav.finance", "masterData.analyticPlans.title"]}
      tableId="analytic-plans"
      service={service}
      columns={analyticPlansColumns}
      exportColumnKeys={analyticPlansExportColumns}
      formFields={analyticPlansFormFields}
      schema={analyticPlansSchema}
      defaultValues={analyticPlansDefaultValues}
      permissionPrefix="masterdata.analytic-plans"
      rowLabel={analyticPlanRowLabel}
    />
  );
}
