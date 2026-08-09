"use client";

import { useEffect, useMemo, useState } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import { usersService, type UserRow } from "@/services/users-service";
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
  type AnalyticAccountRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<WarehouseRow>("/warehouses");
const analyticAccountsService = createMasterDataService<AnalyticAccountRow>("/analytic-accounts");

export default function WarehousesPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [analyticAccounts, setAnalyticAccounts] = useState<AnalyticAccountRow[]>([]);

  useEffect(() => {
    usersService
      .list()
      .then(setUsers)
      .catch(() => setUsers([]));
    analyticAccountsService
      .list({ pageSize: 200 })
      .then((result) => setAnalyticAccounts(result.items))
      .catch(() => setAnalyticAccounts([]));
  }, []);

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
      breadcrumbKeys={["nav.masterData", "masterData.warehouses.title"]}
      tableId="warehouses"
      service={service}
      columns={warehousesColumns}
      exportColumnKeys={warehousesExportColumns}
      formFields={formFields}
      schema={warehousesSchema}
      defaultValues={warehousesDefaultValues}
      permissionPrefix="masterdata.warehouses"
      rowLabel={warehouseRowLabel}
    />
  );
}
