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

const service = createMasterDataService<CurrencyRow>("/currencies");

export default function CurrenciesPage() {
  return (
    <MasterDataPage
      titleKey="masterData.currencies.title"
      descriptionKey="masterData.currencies.description"
      breadcrumbKeys={["nav.finance", "masterData.currencies.title"]}
      tableId="currencies"
      service={service}
      columns={currenciesColumns}
      exportColumnKeys={currenciesExportColumns}
      formFields={currenciesFormFields}
      schema={currenciesSchema}
      defaultValues={currenciesDefaultValues}
      permissionPrefix="masterdata.currencies"
      rowLabel={currencyRowLabel}
    />
  );
}
