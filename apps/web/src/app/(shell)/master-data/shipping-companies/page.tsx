"use client";

import { useMemo } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  shippingCompaniesColumns,
  shippingCompaniesStaticFields,
  shippingCompaniesSchema,
  shippingCompaniesDefaultValues,
  shippingCompaniesExportColumns,
  shippingCompanyRowLabel,
  type ShippingCompanyRow,
} from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";

const service = createMasterDataService<ShippingCompanyRow>("/shipping-companies");

export default function ShippingCompaniesPage() {
  const { t } = useLocale();

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      shippingCompaniesStaticFields[0],
      {
        name: "type",
        label: "masterData.fields.type",
        type: "select",
        required: true,
        options: [
          { value: "INTERNAL_DELIVERY", label: t("masterData.fields.internalDelivery") },
          { value: "EXTERNAL_COMPANY", label: t("masterData.fields.externalCompany") },
        ],
      },
      shippingCompaniesStaticFields[1],
    ],
    [t],
  );

  return (
    <MasterDataPage
      titleKey="masterData.shippingCompanies.title"
      descriptionKey="masterData.shippingCompanies.description"
      tableId="shipping-companies"
      service={service}
      columns={shippingCompaniesColumns}
      exportColumnKeys={shippingCompaniesExportColumns}
      formFields={formFields}
      schema={shippingCompaniesSchema}
      defaultValues={shippingCompaniesDefaultValues}
      permissionPrefix="masterdata.shipping-companies"
      rowLabel={shippingCompanyRowLabel}
    />
  );
}
