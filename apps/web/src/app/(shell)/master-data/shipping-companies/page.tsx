"use client";

import { useMemo } from "react";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
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
import { textColumn } from "@/config/master-data/shared-columns";
import { usePaymentMethods } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";

/** R15 (D15-9) — a carrier's COD collection method (null = not tracked). */
type CarrierRow = ShippingCompanyRow & { codPaymentMethodId?: string | null };

const service = createMasterDataService<CarrierRow>("/shipping-companies");

/** `""` = not tracked; the API stores it as null. */
const schema = shippingCompaniesSchema.extend({
  codPaymentMethodId: z.string().optional().or(z.literal("")),
});
const defaultValues = { ...shippingCompaniesDefaultValues, codPaymentMethodId: "" };
const toFormValues = (row: CarrierRow) => ({
  name: row.name,
  type: row.type,
  description: row.description ?? "",
  codPaymentMethodId: row.codPaymentMethodId ?? "",
});

export default function ShippingCompaniesPage() {
  const { t } = useLocale();
  const paymentMethods = usePaymentMethods();

  // Only reconciled methods with a clearing account can carry "receivable
  // from the carrier" (the server enforces the same rule).
  const codMethodOptions = useMemo(
    () =>
      paymentMethods
        .filter(
          (method) =>
            method.requiresReconciliation && method.accountId && method.isActive !== false,
        )
        .map((method) => ({
          value: method.id,
          label: method.account ? `${method.name} · ${method.account.code}` : method.name,
        })),
    [paymentMethods],
  );

  const columns = useMemo<ColumnDef<CarrierRow, unknown>[]>(() => {
    const names = new Map(paymentMethods.map((method) => [method.id, method.name]));
    const base = shippingCompaniesColumns as ColumnDef<CarrierRow, unknown>[];
    // The status column stays last.
    return [
      ...base.slice(0, -1),
      textColumn<CarrierRow>("codPaymentMethod", "storeOrderMoney.carrier.codMethod", (row) =>
        row.codPaymentMethodId
          ? (names.get(row.codPaymentMethodId) ?? null)
          : t("storeOrderMoney.carrier.notTracked"),
      ),
      ...base.slice(-1),
    ];
  }, [paymentMethods, t]);

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
      {
        name: "codPaymentMethodId",
        label: "storeOrderMoney.carrier.codMethod",
        type: "select",
        options: codMethodOptions,
        description: t("storeOrderMoney.carrier.codMethodHelp"),
      },
      shippingCompaniesStaticFields[1],
    ],
    [t, codMethodOptions],
  );

  return (
    <MasterDataPage
      titleKey="masterData.shippingCompanies.title"
      descriptionKey="masterData.shippingCompanies.description"
      tableId="shipping-companies"
      service={service}
      columns={columns}
      exportColumnKeys={shippingCompaniesExportColumns}
      formFields={formFields}
      schema={schema}
      defaultValues={defaultValues}
      toFormValues={toFormValues}
      permissionPrefix="masterdata.shipping-companies"
      rowLabel={shippingCompanyRowLabel}
    />
  );
}
