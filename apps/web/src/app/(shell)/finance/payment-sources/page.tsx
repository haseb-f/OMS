"use client";

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
} from "@/config/master-data/entities";
import { PermissionGate } from "@/components/shared/permission-gate";

const service = createMasterDataService<PaymentSourceRow>("/payment-sources");

const FORM_FIELDS: MasterDataFormField[] = [
  ...paymentSourcesFormFieldsHead,
  {
    name: "defaultChartOfAccountId",
    label: "masterData.fields.defaultAccount",
    // Remote, cached account search over the whole chart (was the first 500 as a select).
    type: "account",
  },
  ...paymentSourcesFormFieldsTail,
];

/** ADR-0018 (Order Economics M2.2) — "HOW the customer paid" (Visa, Mada, STC Pay, ...), with optional fee estimation config. */
function PaymentSourcesPageContent() {
  return (
    <MasterDataPage
      titleKey="masterData.paymentSources.title"
      descriptionKey="masterData.paymentSources.description"
      tableId="payment-sources"
      service={service}
      columns={paymentSourcesColumns}
      exportColumnKeys={paymentSourcesExportColumns}
      formFields={FORM_FIELDS}
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
