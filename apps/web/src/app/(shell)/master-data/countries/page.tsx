"use client";

import { useMemo } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import {
  countriesColumns,
  countriesFormFields,
  buildCountriesSchema,
  countriesDefaultValues,
  countriesExportColumns,
  countryRowLabel,
  type CountryRow,
} from "@/config/master-data/entities";
import { useCountries, useCurrencies } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";

const service = createMasterDataService<CountryRow>("/countries");

export default function CountriesPage() {
  const { t } = useLocale();
  const schema = useMemo(() => buildCountriesSchema(t), [t]);
  const currencies = useCurrencies();
  const formFields = useMemo(
    () => [
      ...countriesFormFields.map((field) =>
        field.name === "code"
          ? { ...field, description: t("masterData.countries.codeHint") }
          : field,
      ),
      {
        name: "defaultCurrencyId",
        label: "masterData.countries.defaultCurrency" as const,
        type: "select" as const,
        description: t("masterData.countries.defaultCurrencyHint"),
        options: currencies.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
      },
    ],
    [t, currencies],
  );

  return (
    <MasterDataPage
      titleKey="masterData.countries.title"
      descriptionKey="masterData.countries.description"
      tableId="countries"
      service={service}
      columns={countriesColumns}
      exportColumnKeys={countriesExportColumns}
      formFields={formFields}
      schema={schema}
      defaultValues={countriesDefaultValues}
      permissionPrefix="masterdata.countries"
      rowLabel={countryRowLabel}
      onRecordsChanged={() => useCountries.invalidate()}
    />
  );
}
