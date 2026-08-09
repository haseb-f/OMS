"use client";

import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import {
  paymentTermsColumns,
  paymentTermsFormFields,
  paymentTermsSchema,
  paymentTermsDefaultValues,
  paymentTermsExportColumns,
  paymentTermRowLabel,
  type PaymentTermRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<PaymentTermRow>("/payment-terms");

export default function PaymentTermsPage() {
  return (
    <MasterDataPage
      titleKey="masterData.paymentTerms.title"
      descriptionKey="masterData.paymentTerms.description"
      breadcrumbKeys={["nav.masterData", "masterData.paymentTerms.title"]}
      tableId="payment-terms"
      service={service}
      columns={paymentTermsColumns}
      exportColumnKeys={paymentTermsExportColumns}
      formFields={paymentTermsFormFields}
      schema={paymentTermsSchema}
      defaultValues={paymentTermsDefaultValues}
      permissionPrefix="masterdata.paymentterms"
      rowLabel={paymentTermRowLabel}
    />
  );
}
