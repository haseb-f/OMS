"use client";

import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import {
  brandsColumns,
  brandsFormFields,
  brandsSchema,
  brandsDefaultValues,
  brandsExportColumns,
  brandRowLabel,
  type BrandRow,
} from "@/config/master-data/entities";

const service = createMasterDataService<BrandRow>("/product-brands");

export default function BrandsPage() {
  return (
    <MasterDataPage
      titleKey="masterData.brands.title"
      descriptionKey="masterData.brands.description"
      breadcrumbKeys={["nav.products", "masterData.brands.title"]}
      tableId="brands"
      service={service}
      columns={brandsColumns}
      exportColumnKeys={brandsExportColumns}
      formFields={brandsFormFields}
      schema={brandsSchema}
      defaultValues={brandsDefaultValues}
      permissionPrefix="masterdata.brands"
      rowLabel={brandRowLabel}
    />
  );
}
