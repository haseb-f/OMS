"use client";

import { useMemo, useState } from "react";
import { Star } from "lucide-react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import type { RowAction } from "@/components/shared/data-table";
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
import { apiClient, ApiError } from "@/services/api-client";
import { toast } from "@/lib/toast";

const service = createMasterDataService<ShippingStatusRow>("/shipping-statuses");

export default function ShippingStatusesPage() {
  const { t } = useLocale();
  // No exposed reload hook on `MasterDataPage` — bumping this key remounts
  // it (and its own initial fetch) after the "Set as Default" action, the
  // same effect `service.archive`/`service.restore` get for free from its
  // internal `load()`.
  const [refreshKey, setRefreshKey] = useState(0);

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
      {
        name: "syncBehavior",
        label: "masterData.shippingStatuses.syncBehavior.label",
        type: "select",
        required: true,
        options: [
          {
            value: "UNDER_SYNC",
            label: t("masterData.shippingStatuses.syncBehavior.underSync"),
          },
          {
            value: "FINAL",
            label: t("masterData.shippingStatuses.syncBehavior.final"),
          },
        ],
        description: t("masterData.shippingStatuses.syncBehavior.helperText"),
      },
      {
        name: "isDefault",
        label: "masterData.shippingStatuses.default",
        type: "boolean",
      },
    ],
    [t],
  );

  const setDefault = async (row: ShippingStatusRow) => {
    try {
      await apiClient.post(`/shipping-statuses/${row.id}/set-default`);
      toast.success(t("masterData.shippingStatuses.setDefaultSuccess"));
      setRefreshKey((key) => key + 1);
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : t("masterData.shippingStatuses.setDefaultError"),
      );
    }
  };

  return (
    <MasterDataPage
      key={refreshKey}
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
      extraRowActions={(row): RowAction[] => [
        {
          key: "set-default",
          label: t("masterData.shippingStatuses.setDefault"),
          icon: Star,
          hidden: row.isDefault || !!row.deletedAt,
          onSelect: () => void setDefault(row),
        },
      ]}
    />
  );
}
