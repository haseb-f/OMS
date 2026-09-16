"use client";

import { useEffect, useMemo, useState } from "react";
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
  type ChartOfAccountRow,
} from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { PermissionGate } from "@/components/shared/permission-gate";
import type { MessageKey } from "@/i18n/translate";

const service = createMasterDataService<CostComponentRow>("/cost-components");
const accountsService = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");

/** ADR-0017 (Cost Engine M1) — "Cost Categories" (formerly Cost Components) gains accounting-behavior fields. */
function CostComponentsPageContent() {
  const { t } = useLocale();
  const [accounts, setAccounts] = useState<ChartOfAccountRow[]>([]);

  useEffect(() => {
    accountsService
      .list({ pageSize: 500 })
      .then((result) => setAccounts(result.items))
      .catch((error: unknown) => {
        setAccounts([]);
        toast.error(
          error instanceof ApiError
            ? error.message
            : t("common.loadListFailed", { name: t("masterData.fields.defaultAccount") }),
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accountOptions = useMemo(
    () =>
      accounts.map((account) => ({
        value: account.id,
        label: `${account.code} — ${account.name}`,
      })),
    [accounts],
  );

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
        type: "select",
        options: accountOptions,
        description: t("masterData.costComponents.helperText.defaultAccountId"),
      },
      ...costComponentsFormFieldsTail.map((field) =>
        field.name === "capitalizable"
          ? { ...field, description: t("masterData.costComponents.helperText.capitalizable") }
          : field,
      ),
    ],
    [accountOptions, t],
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
