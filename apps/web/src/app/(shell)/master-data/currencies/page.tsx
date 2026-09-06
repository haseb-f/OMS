"use client";

import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import {
  currenciesColumns,
  currenciesFormFields,
  currenciesSchema,
  currenciesDefaultValues,
  currenciesExportColumns,
  currencyRowLabel,
  type CurrencyRow,
} from "@/config/master-data/entities";
import { useCurrencies } from "@/hooks/use-reference-data";

const service = createMasterDataService<CurrencyRow>("/currencies");

export default function CurrenciesPage() {
  return (
    <MasterDataPage
      titleKey="masterData.currencies.title"
      descriptionKey="masterData.currencies.description"
      tableId="currencies"
      service={service}
      columns={currenciesColumns}
      exportColumnKeys={currenciesExportColumns}
      formFields={currenciesFormFields}
      schema={currenciesSchema}
      defaultValues={currenciesDefaultValues}
      permissionPrefix="masterdata.currencies"
      rowLabel={currencyRowLabel}
      onRecordsChanged={() => useCurrencies.invalidate()}
    />
  );
}
