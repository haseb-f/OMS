"use client";

import { useMemo } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  shippingMethodsColumns,
  shippingMethodsStaticFields,
  shippingMethodsSchema,
  shippingMethodsDefaultValues,
  shippingMethodsExportColumns,
  shippingMethodRowLabel,
  type ShippingMethodRow,
} from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";

const service = createMasterDataService<ShippingMethodRow>("/shipping-methods");

export default function ShippingMethodsPage() {
  const { t } = useLocale();

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      shippingMethodsStaticFields[0],
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
      shippingMethodsStaticFields[1],
    ],
    [t],
  );

  return (
    <MasterDataPage
      titleKey="masterData.shippingMethods.title"
      descriptionKey="masterData.shippingMethods.description"
      breadcrumbKeys={["nav.masterData", "masterData.shippingMethods.title"]}
      tableId="shipping-methods"
      service={service}
      columns={shippingMethodsColumns}
      exportColumnKeys={shippingMethodsExportColumns}
      formFields={formFields}
      schema={shippingMethodsSchema}
      defaultValues={shippingMethodsDefaultValues}
      permissionPrefix="masterdata.shipping-methods"
      rowLabel={shippingMethodRowLabel}
    />
  );
}
