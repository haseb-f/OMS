"use client";

import { useEffect, useMemo, useState } from "react";
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
  type ChartOfAccountRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<SupplierGroupRow>("/supplier-groups");
const accountsService = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");

/** TASK-047 (Accounting Configuration) — adds 2 optional account-override selects to the base Supplier Group form. */
export default function SupplierGroupsPage() {
  const [accounts, setAccounts] = useState<ChartOfAccountRow[]>([]);

  useEffect(() => {
    accountsService
      .list({ pageSize: 500 })
      .then((result) => setAccounts(result.items))
      .catch(() => setAccounts([]));
  }, []);

  const accountOptions = useMemo(
    () =>
      accounts.map((account) => ({
        value: account.id,
        label: `${account.code} — ${account.name}`,
      })),
    [accounts],
  );

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      ...supplierGroupsFormFields,
      {
        name: "defaultPayableAccountId",
        label: "accounting.settings.fields.accountsPayable",
        type: "select",
        options: accountOptions,
      },
      {
        name: "defaultPurchaseAccountId",
        label: "accounting.settings.fields.purchase",
        type: "select",
        options: accountOptions,
      },
    ],
    [accountOptions],
  );

  return (
    <MasterDataPage
      titleKey="masterData.supplierGroups.title"
      descriptionKey="masterData.supplierGroups.description"
      breadcrumbKeys={["nav.purchasing", "masterData.supplierGroups.title"]}
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
