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
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const service = createMasterDataService<CategoryRow>("/product-categories");
const accountsService = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");

/** TASK-047 (Accounting Configuration) — adds 4 optional account-override selects to the base Category form. */
export default function CategoriesPage() {
  const { t } = useLocale();
  const [accounts, setAccounts] = useState<ChartOfAccountRow[]>([]);

  useEffect(() => {
    accountsService
      .list({ pageSize: 500 })
      .then((result) => setAccounts(result.items))
      .catch((error: unknown) => {
        setAccounts([]);
        toast.error(
          error instanceof ApiError
            ? error.message
            : t("common.loadListFailed", { name: t("accounting.settings.fields.salesRevenue") }),
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      ...categoriesFormFields.map((field) =>
        field.name === "name"
          ? { ...field, description: t("masterData.categories.helperText.name") }
          : field,
      ),
      {
        name: "revenueAccountId",
        label: "accounting.settings.fields.salesRevenue",
        type: "select",
        options: accountOptions,
        description: t("masterData.categories.helperText.revenueAccountId"),
      },
      {
        name: "inventoryAccountId",
        label: "accounting.settings.fields.inventoryAsset",
        type: "select",
        options: accountOptions,
        description: t("masterData.categories.helperText.inventoryAccountId"),
      },
      {
        name: "cogsAccountId",
        label: "accounting.settings.fields.cogs",
        type: "select",
        options: accountOptions,
        description: t("masterData.categories.helperText.cogsAccountId"),
      },
      {
        name: "purchaseAccountId",
        label: "accounting.settings.fields.purchase",
        type: "select",
        options: accountOptions,
        description: t("masterData.categories.helperText.purchaseAccountId"),
      },
    ],
    [accountOptions, t],
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
