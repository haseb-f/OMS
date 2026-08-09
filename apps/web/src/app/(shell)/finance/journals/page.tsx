"use client";

import { useEffect, useMemo, useState } from "react";
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
  type ChartOfAccountRow,
  type CurrencyRow,
} from "@/config/master-data/entities";
import { useCompany } from "@/providers/company-provider";
import { useLocale } from "@/providers/locale-provider";

const service = createMasterDataService<JournalRow>("/journals");
const accountsService = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");
const currenciesService = createMasterDataService<CurrencyRow>("/currencies");

/** TASK-053 — Journal configuration (Sales/Purchase/Cash/Bank/General): same generic Master Data pattern as Chart of Accounts. */
export default function JournalsPage() {
  const { t } = useLocale();
  const { companies } = useCompany();
  const [accounts, setAccounts] = useState<ChartOfAccountRow[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);

  useEffect(() => {
    accountsService
      .list({ pageSize: 500 })
      .then((result) => setAccounts(result.items))
      .catch(() => setAccounts([]));
    currenciesService
      .list({ pageSize: 200 })
      .then((result) => setCurrencies(result.items))
      .catch(() => setCurrencies([]));
  }, []);

  const accountOptions = useMemo(
    () =>
      accounts.map((account) => ({
        value: account.id,
        label: `${account.code} — ${account.name}`,
      })),
    [accounts],
  );
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
        type: "select",
        options: accountOptions,
      },
      {
        name: "defaultCreditAccountId",
        label: "masterData.fields.defaultCreditAccount",
        type: "select",
        options: accountOptions,
      },
      {
        name: "currencyId",
        label: "masterData.fields.currency",
        type: "select",
        options: currencies.map((currency) => ({ value: currency.id, label: currency.code })),
      },
      {
        name: "branchId",
        label: "masterData.fields.branch",
        type: "select",
        options: branches.map((branch) => ({ value: branch.id, label: branch.name })),
      },
    ],
    [t, accountOptions, currencies, branches],
  );

  return (
    <MasterDataPage
      titleKey="masterData.journals.title"
      descriptionKey="masterData.journals.description"
      breadcrumbKeys={["nav.finance", "masterData.journals.title"]}
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
