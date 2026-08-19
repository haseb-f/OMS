"use client";

import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import {
  countriesColumns,
  countriesFormFields,
  countriesSchema,
  countriesDefaultValues,
  countriesExportColumns,
  countryRowLabel,
  type CountryRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<CountryRow>("/countries");

export default function CountriesPage() {
  return (
    <MasterDataPage
      titleKey="masterData.countries.title"
      descriptionKey="masterData.countries.description"
      tableId="countries"
      service={service}
      columns={countriesColumns}
      exportColumnKeys={countriesExportColumns}
      formFields={countriesFormFields}
      schema={countriesSchema}
      defaultValues={countriesDefaultValues}
      permissionPrefix="masterdata.countries"
      rowLabel={countryRowLabel}
    />
  );
}
