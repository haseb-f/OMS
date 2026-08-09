"use client";

import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import {
  paymentMethodsColumns,
  paymentMethodsFormFields,
  paymentMethodsSchema,
  paymentMethodsDefaultValues,
  paymentMethodsExportColumns,
  paymentMethodRowLabel,
  type PaymentMethodRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<PaymentMethodRow>("/payment-methods");

export default function PaymentMethodsPage() {
  return (
    <MasterDataPage
      titleKey="masterData.paymentMethods.title"
      descriptionKey="masterData.paymentMethods.description"
      breadcrumbKeys={["nav.masterData", "masterData.paymentMethods.title"]}
      tableId="payment-methods"
      service={service}
      columns={paymentMethodsColumns}
      exportColumnKeys={paymentMethodsExportColumns}
      formFields={paymentMethodsFormFields}
      schema={paymentMethodsSchema}
      defaultValues={paymentMethodsDefaultValues}
      permissionPrefix="masterdata.payment-methods"
      rowLabel={paymentMethodRowLabel}
    />
  );
}
