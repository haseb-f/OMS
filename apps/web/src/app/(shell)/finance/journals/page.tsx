"use client";

import { useMemo } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  journalsColumns,
  journalsFormFields,
  journalsSchema,
  journalsDefaultValues,
  journalsExportColumns,
  journalRowLabel,
  type JournalRow,
} from "@/config/master-data/entities";
import { useCompany } from "@/providers/company-provider";
import { useLocale } from "@/providers/locale-provider";
import { useCurrencies } from "@/hooks/use-reference-data";

const service = createMasterDataService<JournalRow>("/journals");

/** TASK-053 — Journal configuration (Sales/Purchase/Cash/Bank/General): same generic Master Data pattern as Chart of Accounts. */
export default function JournalsPage() {
  const { t } = useLocale();
  const { companies } = useCompany();
  const currencies = useCurrencies();
  const branches = useMemo(() => companies.flatMap((company) => company.branches), [companies]);

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      journalsFormFields[0],
      journalsFormFields[1],
      {
        name: "type",
        label: "masterData.fields.journalType",
        type: "select",
        required: true,
        options: (["SALES", "PURCHASE", "CASH", "BANK", "GENERAL"] as const).map((type) => ({
          value: type,
          label: t(`masterData.journals.type.${type}`),
        })),
      },
      journalsFormFields[2],
      {
        name: "defaultDebitAccountId",
        label: "masterData.fields.defaultDebitAccount",
        // Remote, cached account search over the whole chart (was the first 500 as a select).
        type: "account",
      },
      {
        name: "defaultCreditAccountId",
        label: "masterData.fields.defaultCreditAccount",
        type: "account",
      },
      {
        name: "currencyId",
        label: "masterData.fields.currency",
        type: "select",
        options: currencies.map((currency) => ({
          value: currency.id,
          label: `${currency.code} — ${currency.name}`,
        })),
      },
      {
        name: "branchId",
        label: "masterData.fields.branch",
        type: "select",
        options: branches.map((branch) => ({ value: branch.id, label: branch.name })),
      },
    ],
    [t, currencies, branches],
  );

  return (
    <MasterDataPage
      titleKey="masterData.journals.title"
      descriptionKey="masterData.journals.description"
      tableId="journals"
      service={service}
      columns={journalsColumns}
      exportColumnKeys={journalsExportColumns}
      formFields={formFields}
      schema={journalsSchema}
      defaultValues={journalsDefaultValues}
      permissionPrefix="masterdata.journals"
      rowLabel={journalRowLabel}
    />
  );
}
