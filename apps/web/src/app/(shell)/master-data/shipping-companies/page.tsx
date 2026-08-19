"use client";

import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import {
  shippingCompaniesColumns,
  shippingCompaniesFormFields,
  shippingCompaniesSchema,
  shippingCompaniesDefaultValues,
  shippingCompaniesExportColumns,
  shippingCompanyRowLabel,
  type ShippingCompanyRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<ShippingCompanyRow>("/shipping-companies");

export default function ShippingCompaniesPage() {
  return (
    <MasterDataPage
      titleKey="masterData.shippingCompanies.title"
      descriptionKey="masterData.shippingCompanies.description"
      breadcrumbKeys={["nav.shipping", "masterData.shippingCompanies.title"]}
      tableId="shipping-companies"
      service={service}
      columns={shippingCompaniesColumns}
      exportColumnKeys={shippingCompaniesExportColumns}
      formFields={shippingCompaniesFormFields}
      schema={shippingCompaniesSchema}
      defaultValues={shippingCompaniesDefaultValues}
      permissionPrefix="masterdata.shipping-companies"
      rowLabel={shippingCompanyRowLabel}
    />
  );
}
