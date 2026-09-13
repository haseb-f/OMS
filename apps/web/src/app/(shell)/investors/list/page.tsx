"use client";

import { useMemo } from "react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import type { MasterDataFormField } from "@/components/master-data/master-data-form";
import {
  investorsService,
  type InvestorRow,
  type UpdateInvestorPayload,
} from "@/services/investors-service";
import {
  buildInvestorsColumns,
  investorsExportColumns,
  investorRowLabel,
  investorSchema,
  investorDefaultValues,
} from "@/config/investors/investors";
import { useLocale } from "@/providers/locale-provider";

const listService = {
  ...investorsService,
  create: (dto: Record<string, unknown>) =>
    investorsService.create(dto as unknown as Parameters<typeof investorsService.create>[0]),
  update: (id: string, dto: Record<string, unknown>) =>
    investorsService.update(id, dto as UpdateInvestorPayload),
};

export default function InvestorsListPage() {
  const { t } = useLocale();
  const columns = useMemo(() => buildInvestorsColumns(t), [t]);

  const formFields: MasterDataFormField[] = [
    { name: "name", label: "investors.list.fields.name", type: "text", required: true },
    {
      name: "entityType",
      label: "investors.list.fields.entityType",
      type: "select",
      options: (["PERSON", "ORGANIZATION"] as const).map((value) => ({
        value,
        label: t(`investors.list.entityType.${value}`),
      })),
    },
    { name: "phone", label: "investors.list.fields.phone", type: "text" },
    { name: "email", label: "investors.list.fields.email", type: "text" },
    {
      name: "status",
      label: "investors.list.fields.status",
      type: "select",
      options: (["ACTIVE", "INACTIVE"] as const).map((value) => ({
        value,
        label: t(`investors.list.status.${value}`),
      })),
    },
    {
      name: "commercialRegistration",
      label: "investors.list.fields.commercialRegistration",
      type: "text",
    },
    { name: "nationalId", label: "investors.list.fields.nationalId", type: "text" },
    { name: "residencyId", label: "investors.list.fields.residencyId", type: "text" },
    { name: "iban", label: "investors.list.fields.iban", type: "text" },
    { name: "notes", label: "investors.list.fields.notes", type: "textarea" },
  ];

  return (
    <MasterDataPage<InvestorRow>
      titleKey="investors.list.title"
      descriptionKey="investors.list.description"
      tableId="investors"
      service={listService}
      columns={columns}
      exportColumnKeys={investorsExportColumns}
      formFields={formFields}
      schema={investorSchema}
      defaultValues={investorDefaultValues}
      permissionPrefix="investors"
      rowLabel={investorRowLabel}
      defaultSortBy="createdAt"
      defaultSortOrder="desc"
      getRowHref={(row) => `/investors/list/${row.id}`}
    />
  );
}
