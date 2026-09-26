"use client";

import { useMemo } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  costComponentsColumns,
  costComponentsFormFieldsHead,
  costComponentsFormFieldsTail,
  costComponentsSchema,
  costComponentsDefaultValues,
  costComponentsExportColumns,
  costComponentRowLabel,
  COST_ACCOUNTING_CLASSES,
  type CostComponentRow,
} from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { PermissionGate } from "@/components/shared/permission-gate";
import type { MessageKey } from "@/i18n/translate";

const service = createMasterDataService<CostComponentRow>("/cost-components");

/** ADR-0017 (Cost Engine M1) — "Cost Categories" (formerly Cost Components) gains accounting-behavior fields. */
function CostComponentsPageContent() {
  const { t } = useLocale();
  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      ...costComponentsFormFieldsHead,
      {
        name: "accountingClass",
        label: "masterData.fields.accountingClass",
        type: "select",
        required: true,
        options: COST_ACCOUNTING_CLASSES.map((value) => ({
          value,
          label: t(`masterData.costAccountingClass.${value}` as MessageKey),
        })),
      },
      {
        name: "defaultAccountId",
        label: "masterData.fields.defaultAccount",
        // Remote, cached account search over the whole chart (was the first 500 as a select).
        type: "account",
        description: t("masterData.costComponents.helperText.defaultAccountId"),
      },
      ...costComponentsFormFieldsTail.map((field) =>
        field.name === "capitalizable"
          ? { ...field, description: t("masterData.costComponents.helperText.capitalizable") }
          : field,
      ),
    ],
    [t],
  );

  return (
    <MasterDataPage
      titleKey="masterData.costComponents.title"
      descriptionKey="masterData.costComponents.description"
      tableId="cost-components"
      service={service}
      columns={costComponentsColumns}
      exportColumnKeys={costComponentsExportColumns}
      formFields={formFields}
      schema={costComponentsSchema}
      defaultValues={costComponentsDefaultValues}
      permissionPrefix="masterdata.cost-components"
      rowLabel={costComponentRowLabel}
      defaultSortBy="sortOrder"
    />
  );
}

export default function ExpensesCostComponentsPage() {
  return (
    <PermissionGate permission="masterdata.cost-components.view">
      <CostComponentsPageContent />
    </PermissionGate>
  );
}
