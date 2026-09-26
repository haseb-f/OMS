"use client";

import { useMemo } from "react";
import { invalidateLookups } from "@/lib/lookup-cache";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import { useAnalyticAccounts, useUsersList, useWarehouses } from "@/hooks/use-reference-data";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  warehousesColumns,
  warehousesStaticFields,
  warehousesDescriptionField,
  warehousesSchema,
  warehousesDefaultValues,
  warehousesExportColumns,
  warehouseRowLabel,
  type WarehouseRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<WarehouseRow>("/warehouses");

export default function WarehousesPage() {
  const users = useUsersList();
  const analyticAccounts = useAnalyticAccounts();

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      ...warehousesStaticFields,
      {
        name: "managerId",
        label: "masterData.fields.manager",
        type: "select",
        options: users.map((user) => ({ value: user.id, label: user.fullName })),
      },
      {
        name: "defaultAnalyticAccountId",
        label: "masterData.fields.defaultAnalyticAccount",
        type: "select",
        options: analyticAccounts.map((account) => ({ value: account.id, label: account.name })),
      },
      warehousesDescriptionField,
    ],
    [users, analyticAccounts],
  );

  return (
    <MasterDataPage
      titleKey="masterData.warehouses.title"
      descriptionKey="masterData.warehouses.description"
      tableId="warehouses"
      service={service}
      columns={warehousesColumns}
      exportColumnKeys={warehousesExportColumns}
      formFields={formFields}
      schema={warehousesSchema}
      defaultValues={warehousesDefaultValues}
      permissionPrefix="masterdata.warehouses"
      rowLabel={warehouseRowLabel}
      onRecordsChanged={() => {
        useWarehouses.invalidate();
        invalidateLookups("warehouses:");
      }}
    />
  );
}
