"use client";

import { useMemo } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  buildPayrollComponentsColumns,
  payrollComponentsSchema,
  payrollComponentsDefaultValues,
  payrollComponentsExportColumns,
  payrollComponentRowLabel,
} from "@/config/hr/payroll-components";
import { payrollComponentsService } from "@/services/payroll-components-service";
import { useLocale } from "@/providers/locale-provider";

export default function PayrollComponentsPage() {
  const { t } = useLocale();

  const columns = useMemo(() => buildPayrollComponentsColumns(t), [t]);

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      { name: "nameAr", label: "hr.payrollComponents.fields.nameAr", type: "text", required: true },
      { name: "nameEn", label: "hr.payrollComponents.fields.nameEn", type: "text" },
      {
        name: "type",
        label: "hr.payrollComponents.fields.type",
        type: "select",
        required: true,
        options: (["EARNING", "DEDUCTION"] as const).map((value) => ({
          value,
          label: t(`hr.payrollComponents.type.${value}`),
        })),
      },
      {
        name: "calculationType",
        label: "hr.payrollComponents.fields.calculationType",
        type: "select",
        required: true,
        options: (["FIXED", "PERCENTAGE", "VARIABLE"] as const).map((value) => ({
          value,
          label: t(`hr.payrollComponents.calculationType.${value}`),
        })),
      },
      { name: "defaultValue", label: "hr.payrollComponents.fields.defaultValue", type: "number" },
      {
        name: "accountingMappingAccountId",
        label: "hr.payrollComponents.fields.accountingMappingAccountId",
        type: "account",
      },
      { name: "sortOrder", label: "masterData.fields.sortOrder", type: "number" },
      { name: "isActive", label: "masterData.fields.isActive", type: "boolean" },
    ],
    [t],
  );

  return (
    <MasterDataPage
      titleKey="hr.payrollComponents.title"
      descriptionKey="hr.payrollComponents.description"
      tableId="payroll-components"
      service={payrollComponentsService}
      columns={columns}
      exportColumnKeys={payrollComponentsExportColumns}
      formFields={formFields}
      schema={payrollComponentsSchema}
      defaultValues={payrollComponentsDefaultValues}
      permissionPrefix="hr.payroll-components"
      rowLabel={payrollComponentRowLabel}
      defaultSortBy="sortOrder"
    />
  );
}
