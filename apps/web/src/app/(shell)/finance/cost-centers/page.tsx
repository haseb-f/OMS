"use client";

import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import {
  costCentersColumns,
  costCentersFormFields,
  costCentersSchema,
  costCentersDefaultValues,
  costCentersExportColumns,
  costCenterRowLabel,
  type CostCenterRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<CostCenterRow>("/cost-centers");

export default function CostCentersPage() {
  return (
    <MasterDataPage
      titleKey="masterData.costCenters.title"
      descriptionKey="masterData.costCenters.description"
      breadcrumbKeys={["nav.finance", "nav.financeCostCenters"]}
      tableId="cost-centers"
      service={service}
      columns={costCentersColumns}
      exportColumnKeys={costCentersExportColumns}
      formFields={costCentersFormFields}
      schema={costCentersSchema}
      defaultValues={costCentersDefaultValues}
      permissionPrefix="masterdata.cost-centers"
      rowLabel={costCenterRowLabel}
    />
  );
}
