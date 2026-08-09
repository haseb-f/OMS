"use client";

import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import {
  unitsColumns,
  unitsFormFields,
  unitsSchema,
  unitsDefaultValues,
  unitsExportColumns,
  unitRowLabel,
  type UnitRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<UnitRow>("/units");

export default function UnitsPage() {
  return (
    <MasterDataPage
      titleKey="masterData.units.title"
      descriptionKey="masterData.units.description"
      breadcrumbKeys={["nav.masterData", "masterData.units.title"]}
      tableId="units"
      service={service}
      columns={unitsColumns}
      exportColumnKeys={unitsExportColumns}
      formFields={unitsFormFields}
      schema={unitsSchema}
      defaultValues={unitsDefaultValues}
      permissionPrefix="masterdata.units"
      rowLabel={unitRowLabel}
    />
  );
}
