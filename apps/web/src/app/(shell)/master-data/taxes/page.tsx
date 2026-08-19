"use client";

import { useEffect, useMemo, useState } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  taxesColumns,
  taxesFormFields,
  taxesSchema,
  taxesDefaultValues,
  taxesExportColumns,
  taxRowLabel,
  type TaxRow,
  type ChartOfAccountRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<TaxRow>("/taxes");
const accountsService = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");

/** TASK-053 — adds the VAT Output/Input account-override selects to the base Tax form (same pattern as Categories' 4 account overrides). */
export default function TaxesPage() {
  const [accounts, setAccounts] = useState<ChartOfAccountRow[]>([]);

  useEffect(() => {
    accountsService
      .list({ pageSize: 500 })
      .then((result) => setAccounts(result.items))
      .catch(() => setAccounts([]));
  }, []);

  const accountOptions = useMemo(
    () =>
      accounts.map((account) => ({
        value: account.id,
        label: `${account.code} — ${account.name}`,
      })),
    [accounts],
  );

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      ...taxesFormFields,
      {
        name: "outputAccountId",
        label: "accounting.settings.fields.vatOutput",
        type: "select",
        options: accountOptions,
      },
      {
        name: "inputAccountId",
        label: "accounting.settings.fields.vatInput",
        type: "select",
        options: accountOptions,
      },
    ],
    [accountOptions],
  );

  return (
    <MasterDataPage
      titleKey="masterData.taxes.title"
      descriptionKey="masterData.taxes.description"
      tableId="taxes"
      service={service}
      columns={taxesColumns}
      exportColumnKeys={taxesExportColumns}
      formFields={formFields}
      schema={taxesSchema}
      defaultValues={taxesDefaultValues}
      permissionPrefix="masterdata.taxes"
      rowLabel={taxRowLabel}
    />
  );
}
