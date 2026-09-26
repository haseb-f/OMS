"use client";

import { useMemo } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  taxesColumns,
  taxesFormFields,
  taxesSchema,
  taxesDefaultValues,
  taxesExportColumns,
  taxRowLabel,
  type TaxRow,
} from "@/config/master-data/entities";
import { useTaxes } from "@/hooks/use-reference-data";

const service = createMasterDataService<TaxRow>("/taxes");

/** TASK-053 — adds the VAT Output/Input account-override pickers (remote, cached `AccountPicker` search over the whole chart) to the base Tax form (same pattern as Categories' 4 account overrides). */
export default function TaxesPage() {
  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      ...taxesFormFields,
      {
        name: "outputAccountId",
        label: "accounting.settings.fields.vatOutput",
        type: "account",
      },
      {
        name: "inputAccountId",
        label: "accounting.settings.fields.vatInput",
        type: "account",
      },
    ],
    [],
  );

  return (
    <MasterDataPage
      titleKey="masterData.taxes.title"
      descriptionKey="masterData.taxes.description"
      tableId="taxes"
      service={service}
      columns={taxesColumns}
      exportColumnKeys={taxesExportColumns}
      formFields={formFields}
      schema={taxesSchema}
      defaultValues={taxesDefaultValues}
      permissionPrefix="masterdata.taxes"
      rowLabel={taxRowLabel}
      onRecordsChanged={() => useTaxes.invalidate()}
      toFormValues={(entity) => ({
        code: entity.code,
        name: entity.name,
        rate: Number(entity.rate),
        inclusive: Boolean(entity.inclusive),
        description: entity.description ?? "",
        outputAccountId: entity.outputAccountId ?? "",
        inputAccountId: entity.inputAccountId ?? "",
      })}
    />
  );
}
