"use client";

import { useMemo } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  supplierGroupsColumns,
  supplierGroupsFormFields,
  supplierGroupsSchema,
  supplierGroupsDefaultValues,
  supplierGroupsExportColumns,
  supplierGroupRowLabel,
  type SupplierGroupRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<SupplierGroupRow>("/supplier-groups");

/** TASK-047 (Accounting Configuration) — adds 2 optional account-override pickers (remote, cached `AccountPicker` search over the whole chart) to the base Supplier Group form. */
export default function SupplierGroupsPage() {
  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      ...supplierGroupsFormFields,
      {
        name: "defaultPayableAccountId",
        label: "accounting.settings.fields.accountsPayable",
        type: "account",
      },
      {
        name: "defaultPurchaseAccountId",
        label: "accounting.settings.fields.purchase",
        type: "account",
      },
    ],
    [],
  );

  return (
    <MasterDataPage
      titleKey="masterData.supplierGroups.title"
      descriptionKey="masterData.supplierGroups.description"
      tableId="supplier-groups"
      service={service}
      columns={supplierGroupsColumns}
      exportColumnKeys={supplierGroupsExportColumns}
      formFields={formFields}
      schema={supplierGroupsSchema}
      defaultValues={supplierGroupsDefaultValues}
      permissionPrefix="masterdata.supplier-groups"
      rowLabel={supplierGroupRowLabel}
    />
  );
}
