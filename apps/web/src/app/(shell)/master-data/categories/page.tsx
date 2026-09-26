"use client";

import { useMemo } from "react";
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
} from "@/config/master-data/entities";
import { useProductCategories } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";

const service = createMasterDataService<CategoryRow>("/product-categories");

/** TASK-047 (Accounting Configuration) — adds 4 optional account-override pickers (remote, cached `AccountPicker` search over the whole chart) to the base Category form. */
export default function CategoriesPage() {
  const { t } = useLocale();
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
        type: "account",
        description: t("masterData.categories.helperText.revenueAccountId"),
      },
      {
        name: "inventoryAccountId",
        label: "accounting.settings.fields.inventoryAsset",
        type: "account",
        description: t("masterData.categories.helperText.inventoryAccountId"),
      },
      {
        name: "cogsAccountId",
        label: "accounting.settings.fields.cogs",
        type: "account",
        description: t("masterData.categories.helperText.cogsAccountId"),
      },
      {
        name: "purchaseAccountId",
        label: "accounting.settings.fields.purchase",
        type: "account",
        description: t("masterData.categories.helperText.purchaseAccountId"),
      },
    ],
    [t],
  );

  return (
    <MasterDataPage
      titleKey="masterData.categories.title"
      descriptionKey="masterData.categories.description"
      tableId="categories"
      service={service}
      columns={categoriesColumns}
      exportColumnKeys={categoriesExportColumns}
      formFields={formFields}
      schema={categoriesSchema}
      defaultValues={categoriesDefaultValues}
      permissionPrefix="masterdata.categories"
      rowLabel={categoryRowLabel}
      onRecordsChanged={() => useProductCategories.invalidate()}
    />
  );
}
