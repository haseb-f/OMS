"use client";

import { useEffect, useMemo, useState } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  fixedAssetsColumns,
  fixedAssetsFormFields,
  fixedAssetsSchema,
  fixedAssetsDefaultValues,
  fixedAssetsExportColumns,
  fixedAssetRowLabel,
  type FixedAssetRow,
  type CostCenterRow,
} from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const service = createMasterDataService<FixedAssetRow>("/fixed-assets");
const costCentersService = createMasterDataService<CostCenterRow>("/cost-centers");

/** A simple fixed-asset register entry — name/acquisition date/cost, optionally attributed to a Cost Center. No depreciation calculation, no journal-entry posting (architecture only, same scoping as Expenses). */
export default function FixedAssetsPage() {
  const { t } = useLocale();
  const [costCenters, setCostCenters] = useState<CostCenterRow[]>([]);

  useEffect(() => {
    costCentersService
      .list({ pageSize: 500 })
      .then((result) => setCostCenters(result.items))
      .catch((error: unknown) => {
        setCostCenters([]);
        toast.error(
          error instanceof ApiError
            ? error.message
            : t("common.loadListFailed", { name: t("masterData.expenses.fields.costCenter") }),
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      ...fixedAssetsFormFields,
      {
        name: "costCenterId",
        label: "masterData.expenses.fields.costCenter",
        type: "select",
        options: costCenters.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
      },
    ],
    [costCenters],
  );

  return (
    <MasterDataPage
      titleKey="masterData.fixedAssets.title"
      descriptionKey="masterData.fixedAssets.description"
      tableId="fixed-assets"
      service={service}
      columns={fixedAssetsColumns}
      exportColumnKeys={fixedAssetsExportColumns}
      formFields={formFields}
      schema={fixedAssetsSchema}
      defaultValues={fixedAssetsDefaultValues}
      permissionPrefix="masterdata.fixed-assets"
      rowLabel={fixedAssetRowLabel}
    />
  );
}
