"use client";

import { useMemo } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  shippingStatusesColumns,
  shippingStatusesStaticFields,
  shippingStatusesSchema,
  shippingStatusesDefaultValues,
  shippingStatusesExportColumns,
  shippingStatusRowLabel,
  type ShippingStatusRow,
} from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";

const service = createMasterDataService<ShippingStatusRow>("/shipping-statuses");

export default function ShippingStatusesPage() {
  const { t } = useLocale();

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      shippingStatusesStaticFields[0],
      {
        name: "color",
        label: "masterData.fields.color",
        type: "select",
        required: true,
        options: [
          { value: "neutral", label: t("masterData.colors.neutral") },
          { value: "info", label: t("masterData.colors.info") },
          { value: "warning", label: t("masterData.colors.warning") },
          { value: "success", label: t("masterData.colors.success") },
          { value: "destructive", label: t("masterData.colors.destructive") },
        ],
      },
    ],
    [t],
  );

  return (
    <MasterDataPage
      titleKey="masterData.shippingStatuses.title"
      descriptionKey="masterData.shippingStatuses.description"
      tableId="shipping-statuses"
      service={service}
      columns={shippingStatusesColumns}
      exportColumnKeys={shippingStatusesExportColumns}
      formFields={formFields}
      schema={shippingStatusesSchema}
      defaultValues={shippingStatusesDefaultValues}
      permissionPrefix="masterdata.shipping-statuses"
      rowLabel={shippingStatusRowLabel}
      defaultSortBy="sortOrder"
      isRowProtected={(row) => row.isDefault}
    />
  );
}
