"use client";

import { useEffect, useMemo, useState } from "react";
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
  type ChartOfAccountRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<CustomerGroupRow>("/customer-groups");
const accountsService = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");

/** TASK-047 (Accounting Configuration) — adds 2 optional account-override selects to the base Customer Group form. */
export default function CustomerGroupsPage() {
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
      ...customerGroupsFormFields,
      {
        name: "defaultReceivableAccountId",
        label: "accounting.settings.fields.accountsReceivable",
        type: "select",
        options: accountOptions,
      },
      {
        name: "defaultRevenueAccountId",
        label: "accounting.settings.fields.salesRevenue",
        type: "select",
        options: accountOptions,
      },
    ],
    [accountOptions],
  );

  return (
    <MasterDataPage
      titleKey="masterData.customerGroups.title"
      descriptionKey="masterData.customerGroups.description"
      breadcrumbKeys={["nav.sales", "masterData.customerGroups.title"]}
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
