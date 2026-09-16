"use client";

import { useEffect, useMemo, useState } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  paymentSourcesColumns,
  paymentSourcesFormFieldsHead,
  paymentSourcesFormFieldsTail,
  paymentSourcesSchema,
  paymentSourcesDefaultValues,
  paymentSourcesExportColumns,
  paymentSourceRowLabel,
  type PaymentSourceRow,
  type ChartOfAccountRow,
} from "@/config/master-data/entities";
import { PermissionGate } from "@/components/shared/permission-gate";

const service = createMasterDataService<PaymentSourceRow>("/payment-sources");
const accountsService = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");

/** ADR-0018 (Order Economics M2.2) — "HOW the customer paid" (Visa, Mada, STC Pay, ...), with optional fee estimation config. */
function PaymentSourcesPageContent() {
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
      ...paymentSourcesFormFieldsHead,
      {
        name: "defaultChartOfAccountId",
        label: "masterData.fields.defaultAccount",
        type: "select",
        options: accountOptions,
      },
      ...paymentSourcesFormFieldsTail,
    ],
    [accountOptions],
  );

  return (
    <MasterDataPage
      titleKey="masterData.paymentSources.title"
      descriptionKey="masterData.paymentSources.description"
      tableId="payment-sources"
      service={service}
      columns={paymentSourcesColumns}
      exportColumnKeys={paymentSourcesExportColumns}
      formFields={formFields}
      schema={paymentSourcesSchema}
      defaultValues={paymentSourcesDefaultValues}
      permissionPrefix="masterdata.payment-sources"
      rowLabel={paymentSourceRowLabel}
      defaultSortBy="sortOrder"
    />
  );
}

export default function FinancePaymentSourcesPage() {
  return (
    <PermissionGate permission="masterdata.payment-sources.view">
      <PaymentSourcesPageContent />
    </PermissionGate>
  );
}
