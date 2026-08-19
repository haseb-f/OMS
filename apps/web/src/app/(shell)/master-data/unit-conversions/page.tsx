"use client";

import { useEffect, useMemo, useState } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  unitConversionsColumns,
  unitConversionsStaticFields,
  unitConversionsSchema,
  unitConversionsDefaultValues,
  unitConversionsExportColumns,
  unitConversionRowLabel,
  type UnitConversionRow,
  type UnitRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<UnitConversionRow>("/unit-conversions");
const unitsService = createMasterDataService<UnitRow>("/units");

export default function UnitConversionsPage() {
  const [units, setUnits] = useState<UnitRow[]>([]);

  useEffect(() => {
    unitsService
      .list({ pageSize: 200 })
      .then((result) => setUnits(result.items))
      .catch(() => setUnits([]));
  }, []);

  const formFields = useMemo<MasterDataFormField[]>(() => {
    const options = units.map((unit) => ({ value: unit.id, label: unit.name }));
    return [
      {
        name: "fromUnitId",
        label: "masterData.fields.fromUnit",
        type: "select",
        required: true,
        options,
      },
      {
        name: "toUnitId",
        label: "masterData.fields.toUnit",
        type: "select",
        required: true,
        options,
      },
      ...unitConversionsStaticFields,
      { name: "isActive", label: "masterData.fields.isActive", type: "boolean" },
    ];
  }, [units]);

  return (
    <MasterDataPage
      titleKey="masterData.unitConversions.title"
      descriptionKey="masterData.unitConversions.description"
      tableId="unit-conversions"
      service={service}
      columns={unitConversionsColumns}
      exportColumnKeys={unitConversionsExportColumns}
      formFields={formFields}
      schema={unitConversionsSchema}
      defaultValues={unitConversionsDefaultValues}
      permissionPrefix="masterdata.units"
      rowLabel={unitConversionRowLabel}
    />
  );
}
