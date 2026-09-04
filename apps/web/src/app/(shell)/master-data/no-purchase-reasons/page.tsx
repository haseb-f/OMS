"use client";

import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import {
  noPurchaseReasonsColumns,
  noPurchaseReasonsFormFields,
  noPurchaseReasonsSchema,
  noPurchaseReasonsDefaultValues,
  noPurchaseReasonsExportColumns,
  noPurchaseReasonRowLabel,
  type NoPurchaseReasonRow,
} from "@/config/master-data/entities";
import { useNoPurchaseReasons } from "@/hooks/use-reference-data";

const service = createMasterDataService<NoPurchaseReasonRow>("/no-purchase-reasons");

export default function NoPurchaseReasonsPage() {
  return (
    <MasterDataPage
      titleKey="masterData.noPurchaseReasons.title"
      descriptionKey="masterData.noPurchaseReasons.description"
      tableId="no-purchase-reasons"
      service={service}
      columns={noPurchaseReasonsColumns}
      exportColumnKeys={noPurchaseReasonsExportColumns}
      formFields={noPurchaseReasonsFormFields}
      schema={noPurchaseReasonsSchema}
      defaultValues={noPurchaseReasonsDefaultValues}
      permissionPrefix="masterdata.no-purchase-reasons"
      rowLabel={noPurchaseReasonRowLabel}
      defaultSortBy="sortOrder"
      onRecordsChanged={() => useNoPurchaseReasons.invalidate()}
    />
  );
}
