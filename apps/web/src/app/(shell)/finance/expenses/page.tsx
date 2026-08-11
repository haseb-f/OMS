"use client";

import { useEffect, useMemo, useState } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import { createMasterDataService } from "@/services/master-data-service";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  expensesColumns,
  expensesFormFields,
  expensesSchema,
  expensesDefaultValues,
  expensesExportColumns,
  expenseRowLabel,
  type ExpenseRow,
  type CostCenterRow,
  type PaymentMethodRow,
} from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const service = createMasterDataService<ExpenseRow>("/expenses");
const costCentersService = createMasterDataService<CostCenterRow>("/cost-centers");
const paymentMethodsService = createMasterDataService<PaymentMethodRow>("/payment-methods");

/** A simple recorded expense — date/amount/description, optionally attributed to a Cost Center and Payment Method. No approval workflow, no journal-entry posting (architecture only, matching the Cost Engine Foundation's scoping). */
export default function ExpensesPage() {
  const { t } = useLocale();
  const [costCenters, setCostCenters] = useState<CostCenterRow[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRow[]>([]);

  useEffect(() => {
    costCentersService
      .list({ pageSize: 500 })
      .then((result) => setCostCenters(result.items))
      .catch((error: unknown) => {
        setCostCenters([]);
        toast.error(
          error instanceof ApiError
            ? error.message
            : t("common.loadListFailed", { name: t("masterData.expenses.fields.costCenter") }),
        );
      });
    paymentMethodsService
      .list({ pageSize: 500 })
      .then((result) => setPaymentMethods(result.items))
      .catch((error: unknown) => {
        setPaymentMethods([]);
        toast.error(
          error instanceof ApiError
            ? error.message
            : t("common.loadListFailed", { name: t("masterData.expenses.fields.paymentMethod") }),
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formFields = useMemo<MasterDataFormField[]>(
    () => [
      ...expensesFormFields,
      {
        name: "costCenterId",
        label: "masterData.expenses.fields.costCenter",
        type: "select",
        options: costCenters.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
      },
      {
        name: "paymentMethodId",
        label: "masterData.expenses.fields.paymentMethod",
        type: "select",
        options: paymentMethods.map((p) => ({ value: p.id, label: p.name })),
      },
    ],
    [costCenters, paymentMethods],
  );

  return (
    <MasterDataPage
      titleKey="masterData.expenses.title"
      descriptionKey="masterData.expenses.description"
      breadcrumbKeys={["nav.finance", "nav.financeExpenses"]}
      tableId="expenses"
      defaultSortBy="date"
      service={service}
      columns={expensesColumns}
      exportColumnKeys={expensesExportColumns}
      formFields={formFields}
      schema={expensesSchema}
      defaultValues={expensesDefaultValues}
      permissionPrefix="masterdata.expenses"
      rowLabel={expenseRowLabel}
    />
  );
}
