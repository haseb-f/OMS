"use client";

import { useMemo } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  customerGroupsColumns,
  customerGroupsFormFields,
  customerGroupsSchema,
  customerGroupsDefaultValues,
  customerGroupsExportColumns,
  customerGroupRowLabel,
  type CustomerGroupRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<CustomerGroupRow>("/customer-groups");

/** TASK-047 (Accounting Configuration) — adds 2 optional account-override pickers (remote, cached `AccountPicker` search over the whole chart) to the base Customer Group form. */
export default function CustomerGroupsPage() {
  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      ...customerGroupsFormFields,
      {
        name: "defaultReceivableAccountId",
        label: "accounting.settings.fields.accountsReceivable",
        type: "account",
      },
      {
        name: "defaultRevenueAccountId",
        label: "accounting.settings.fields.salesRevenue",
        type: "account",
      },
    ],
    [],
  );

  return (
    <MasterDataPage
      titleKey="masterData.customerGroups.title"
      descriptionKey="masterData.customerGroups.description"
      tableId="customer-groups"
      service={service}
      columns={customerGroupsColumns}
      exportColumnKeys={customerGroupsExportColumns}
      formFields={formFields}
      schema={customerGroupsSchema}
      defaultValues={customerGroupsDefaultValues}
      permissionPrefix="masterdata.customer-groups"
      rowLabel={customerGroupRowLabel}
    />
  );
}
