"use client";

import { useEffect, useMemo, useState } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  categoriesColumns,
  categoriesFormFields,
  categoriesSchema,
  categoriesDefaultValues,
  categoriesExportColumns,
  categoryRowLabel,
  type CategoryRow,
  type ChartOfAccountRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<CategoryRow>("/product-categories");
const accountsService = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");

/** TASK-047 (Accounting Configuration) — adds 4 optional account-override selects to the base Category form. */
export default function CategoriesPage() {
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
      ...categoriesFormFields,
      {
        name: "revenueAccountId",
        label: "accounting.settings.fields.salesRevenue",
        type: "select",
        options: accountOptions,
      },
      {
        name: "inventoryAccountId",
        label: "accounting.settings.fields.inventoryAsset",
        type: "select",
        options: accountOptions,
      },
      {
        name: "cogsAccountId",
        label: "accounting.settings.fields.cogs",
        type: "select",
        options: accountOptions,
      },
      {
        name: "purchaseAccountId",
        label: "accounting.settings.fields.purchase",
        type: "select",
        options: accountOptions,
      },
    ],
    [accountOptions],
  );

  return (
    <MasterDataPage
      titleKey="masterData.categories.title"
      descriptionKey="masterData.categories.description"
      breadcrumbKeys={["nav.masterData", "masterData.categories.title"]}
      tableId="categories"
      service={service}
      columns={categoriesColumns}
      exportColumnKeys={categoriesExportColumns}
      formFields={formFields}
      schema={categoriesSchema}
      defaultValues={categoriesDefaultValues}
      permissionPrefix="masterdata.categories"
      rowLabel={categoryRowLabel}
    />
  );
}
