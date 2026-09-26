"use client";

import { useMemo } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import { useUnits } from "@/hooks/use-reference-data";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  unitConversionsColumns,
  unitConversionsStaticFields,
  unitConversionsSchema,
  unitConversionsDefaultValues,
  unitConversionsExportColumns,
  unitConversionRowLabel,
  type UnitConversionRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<UnitConversionRow>("/unit-conversions");

export default function UnitConversionsPage() {
  const units = useUnits();

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
