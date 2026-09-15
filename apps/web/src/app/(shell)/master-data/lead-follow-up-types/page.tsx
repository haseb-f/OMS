"use client";

import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import {
  leadFollowUpTypesColumns,
  leadFollowUpTypesFormFields,
  leadFollowUpTypesSchema,
  leadFollowUpTypesDefaultValues,
  leadFollowUpTypesExportColumns,
  leadFollowUpTypeRowLabel,
  type LeadFollowUpTypeRow,
} from "@/config/master-data/entities";
import { useLeadFollowUpTypes } from "@/hooks/use-reference-data";

const service = createMasterDataService<LeadFollowUpTypeRow>("/lead-follow-up-types");

export default function LeadFollowUpTypesPage() {
  return (
    <MasterDataPage
      titleKey="masterData.leadFollowUpTypes.title"
      descriptionKey="masterData.leadFollowUpTypes.description"
      tableId="lead-follow-up-types"
      service={service}
      columns={leadFollowUpTypesColumns}
      exportColumnKeys={leadFollowUpTypesExportColumns}
      formFields={leadFollowUpTypesFormFields}
      schema={leadFollowUpTypesSchema}
      defaultValues={leadFollowUpTypesDefaultValues}
      permissionPrefix="masterdata.lead-follow-up-types"
      rowLabel={leadFollowUpTypeRowLabel}
      defaultSortBy="sortOrder"
      onRecordsChanged={() => useLeadFollowUpTypes.invalidate()}
    />
  );
}
