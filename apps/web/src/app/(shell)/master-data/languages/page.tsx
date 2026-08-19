"use client";

import { useMemo } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  languagesColumns,
  languagesStaticFields,
  languagesSchema,
  languagesDefaultValues,
  languagesExportColumns,
  languageRowLabel,
  type LanguageRow,
} from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";

const service = createMasterDataService<LanguageRow>("/languages");

export default function LanguagesPage() {
  const { t } = useLocale();

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      ...languagesStaticFields,
      {
        name: "direction",
        label: "masterData.fields.direction",
        type: "select",
        required: true,
        options: [
          { value: "RTL", label: t("masterData.fields.rtl") },
          { value: "LTR", label: t("masterData.fields.ltr") },
        ],
      },
    ],
    [t],
  );

  return (
    <MasterDataPage
      titleKey="masterData.languages.title"
      descriptionKey="masterData.languages.description"
      tableId="languages"
      service={service}
      columns={languagesColumns}
      exportColumnKeys={languagesExportColumns}
      formFields={formFields}
      schema={languagesSchema}
      defaultValues={languagesDefaultValues}
      permissionPrefix="masterdata.languages"
      rowLabel={languageRowLabel}
    />
  );
}
