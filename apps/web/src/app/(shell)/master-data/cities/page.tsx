"use client";

import { useMemo } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import { useCountries } from "@/hooks/use-reference-data";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  citiesColumns,
  citiesStaticFields,
  citiesSchema,
  citiesDefaultValues,
  citiesExportColumns,
  cityRowLabel,
  type CityRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<CityRow>("/cities");

export default function CitiesPage() {
  const countries = useCountries();

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      {
        name: "countryId",
        label: "masterData.fields.country",
        type: "select",
        required: true,
        options: countries.map((country) => ({ value: country.id, label: country.name })),
      },
      ...citiesStaticFields,
    ],
    [countries],
  );

  return (
    <MasterDataPage
      titleKey="masterData.cities.title"
      descriptionKey="masterData.cities.description"
      breadcrumbKeys={["nav.masterData", "masterData.cities.title"]}
      tableId="cities"
      service={service}
      columns={citiesColumns}
      exportColumnKeys={citiesExportColumns}
      formFields={formFields}
      schema={citiesSchema}
      defaultValues={citiesDefaultValues}
      permissionPrefix="masterdata.cities"
      rowLabel={cityRowLabel}
    />
  );
}
