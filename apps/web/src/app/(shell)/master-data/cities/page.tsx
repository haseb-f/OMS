"use client";

import { useEffect, useMemo, useState } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  citiesColumns,
  citiesStaticFields,
  citiesSchema,
  citiesDefaultValues,
  citiesExportColumns,
  cityRowLabel,
  type CityRow,
  type CountryRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<CityRow>("/cities");
const countriesService = createMasterDataService<CountryRow>("/countries");

export default function CitiesPage() {
  const [countries, setCountries] = useState<CountryRow[]>([]);

  useEffect(() => {
    countriesService
      .list({ pageSize: 200 })
      .then((result) => setCountries(result.items))
      .catch(() => setCountries([]));
  }, []);

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
