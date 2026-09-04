"use client";

import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import {
  customerClassificationsColumns,
  customerClassificationsFormFields,
  customerClassificationsSchema,
  customerClassificationsDefaultValues,
  customerClassificationsExportColumns,
  customerClassificationRowLabel,
  type CustomerClassificationRow,
} from "@/config/master-data/entities";
import { useCustomerClassifications } from "@/hooks/use-reference-data";

const service = createMasterDataService<CustomerClassificationRow>("/customer-classifications");

export default function CustomerClassificationsPage() {
  return (
    <MasterDataPage
      titleKey="masterData.customerClassifications.title"
      descriptionKey="masterData.customerClassifications.description"
      tableId="customer-classifications"
      service={service}
      columns={customerClassificationsColumns}
      exportColumnKeys={customerClassificationsExportColumns}
      formFields={customerClassificationsFormFields}
      schema={customerClassificationsSchema}
      defaultValues={customerClassificationsDefaultValues}
      permissionPrefix="masterdata.customer-classifications"
      rowLabel={customerClassificationRowLabel}
      defaultSortBy="sortOrder"
      onRecordsChanged={() => useCustomerClassifications.invalidate()}
    />
  );
}
