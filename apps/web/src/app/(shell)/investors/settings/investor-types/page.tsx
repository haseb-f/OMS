"use client";

import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import {
  investorTypesColumns,
  investorTypesFormFields,
  investorTypesSchema,
  investorTypesDefaultValues,
  investorTypesExportColumns,
  investorTypeRowLabel,
  type InvestorTypeRow,
} from "@/config/master-data/entities";
import { useInvestorTypes } from "@/hooks/use-reference-data";

const service = createMasterDataService<InvestorTypeRow>("/investor-types");

export default function InvestorTypesSettingsPage() {
  return (
    <MasterDataPage
      titleKey="masterData.investorTypes.title"
      descriptionKey="masterData.investorTypes.description"
      tableId="investor-types"
      service={service}
      columns={investorTypesColumns}
      exportColumnKeys={investorTypesExportColumns}
      formFields={investorTypesFormFields}
      schema={investorTypesSchema}
      defaultValues={investorTypesDefaultValues}
      permissionPrefix="investor-settings"
      rowLabel={investorTypeRowLabel}
      defaultSortBy="sortOrder"
      onRecordsChanged={() => useInvestorTypes.invalidate()}
    />
  );
}
