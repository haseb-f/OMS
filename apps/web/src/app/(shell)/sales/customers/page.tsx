"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UserCircle, Eye } from "lucide-react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import type { MasterDataFormSection } from "@/components/master-data/master-data-form";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import type { RowAction } from "@/components/shared/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  customersService,
  type CustomerRow,
  type CustomerSourceValue,
} from "@/services/customers-service";
import { createMasterDataService } from "@/services/master-data-service";
import type { PaymentTermRow, CustomerGroupRow } from "@/config/master-data/entities";
import {
  customerColumns,
  customerExportColumns,
  customerRowLabel,
} from "@/config/sales/customer-columns";
import { buildCustomerSchema, customerDefaultValues } from "@/config/sales/customer-form";
import { useLocale } from "@/providers/locale-provider";
import { PermissionGate } from "@/components/shared/permission-gate";
import { useCurrencies, useCountries } from "@/hooks/use-reference-data";

const paymentTermsService = createMasterDataService<PaymentTermRow>("/payment-terms");
const customerGroupsService = createMasterDataService<CustomerGroupRow>("/customer-groups");

const SOURCE_VALUES: CustomerSourceValue[] = [
  "MANUAL",
  "WEBSITE",
  "SALLA",
  "API",
  "IMPORT",
  "GOOGLE_SHEETS",
  "LEAD_CONVERSION",
  "OTHER",
];

function CustomersPageContent() {
  const { t } = useLocale();
  const router = useRouter();

  const currencies = useCurrencies();
  const countries = useCountries();
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermRow[]>([]);
  const [customerGroups, setCustomerGroups] = useState<CustomerGroupRow[]>([]);
  const [sourceFilter, setSourceFilter] = useState<string>("");

  useEffect(() => {
    paymentTermsService
      .list({ pageSize: 200 })
      .then((r) => setPaymentTerms(r.items))
      .catch(() => setPaymentTerms([]));
    customerGroupsService
      .list({ pageSize: 200 })
      .then((r) => setCustomerGroups(r.items))
      .catch(() => setCustomerGroups([]));
  }, []);

  const formSections = useMemo<MasterDataFormSection[]>(
    () => [
      {
        title: t("sales.customers.sections.general"),
        columns: 2,
        fields: [
          { name: "name", label: "sales.customers.fields.name", type: "text", required: true },
          { name: "commercialName", label: "sales.customers.fields.commercialName", type: "text" },
          {
            name: "customerGroupId",
            label: "sales.customers.fields.customerGroup",
            type: "select",
            options: customerGroups.map((g) => ({ value: g.id, label: g.name })),
          },
        ],
      },
      {
        title: t("sales.customers.sections.contact"),
        columns: 2,
        fields: [
          {
            name: "phone",
            label: "sales.customers.fields.phone",
            type: "phone",
            countryFieldName: "countryId",
          },
          {
            name: "mobile",
            label: "sales.customers.fields.mobile",
            type: "phone",
            countryFieldName: "countryId",
          },
          { name: "email", label: "sales.customers.fields.email", type: "text" },
          { name: "website", label: "sales.customers.fields.website", type: "text" },
        ],
      },
      {
        title: t("sales.customers.sections.commercial"),
        columns: 2,
        fields: [
          { name: "taxNumber", label: "sales.customers.fields.taxNumber", type: "text" },
          {
            name: "commercialRegistration",
            label: "sales.customers.fields.commercialRegistration",
            type: "text",
          },
          {
            name: "currencyId",
            label: "sales.customers.fields.currency",
            type: "select",
            options: currencies.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
          },
          {
            name: "paymentTermId",
            label: "sales.customers.fields.paymentTerm",
            type: "select",
            options: paymentTerms.map((p) => ({ value: p.id, label: p.name })),
          },
          { name: "creditLimit", label: "sales.customers.fields.creditLimit", type: "number" },
        ],
      },
      {
        title: t("sales.customers.sections.addresses"),
        columns: 2,
        fields: [
          {
            name: "countryId",
            label: "sales.customers.fields.country",
            type: "country",
          },
          { name: "city", label: "sales.customers.fields.city", type: "text" },
          { name: "address", label: "sales.customers.fields.address", type: "text" },
        ],
      },
      {
        title: t("sales.customers.sections.notes"),
        columns: 2,
        fields: [{ name: "notes", label: "sales.customers.fields.notes", type: "textarea" }],
      },
    ],
    [t, customerGroups, currencies, paymentTerms, countries],
  );

  const customerSchema = useMemo(() => buildCustomerSchema(countries, t), [countries, t]);

  return (
    <MasterDataPage<CustomerRow>
      titleKey="sales.customers.title"
      descriptionKey="sales.customers.description"
      breadcrumbKeys={["nav.sales", "sales.customers.title"]}
      tableId="sales-customers"
      icon={UserCircle}
      service={customersService}
      columns={customerColumns}
      exportColumnKeys={customerExportColumns}
      formSections={formSections}
      schema={customerSchema}
      phoneCountries={countries}
      defaultValues={customerDefaultValues}
      permissionPrefix="sales.customers"
      rowLabel={customerRowLabel}
      supportsSelectAllMatching
      extraActions={<ModuleImportButtons importType="CUSTOMERS" />}
      extraListParams={sourceFilter ? { source: sourceFilter } : undefined}
      extraFilters={
        <Select
          value={sourceFilter || "__all__"}
          onValueChange={(v) => setSourceFilter(v === "__all__" ? "" : v)}
        >
          <SelectTrigger size="sm" className="w-40">
            <SelectValue placeholder={t("sales.customers.filters.source")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("sales.customers.filters.allSources")}</SelectItem>
            {SOURCE_VALUES.map((source) => (
              <SelectItem key={source} value={source}>
                {t(`sales.customers.source.${source}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
      extraRowActions={(entity): RowAction[] => [
        {
          key: "view-profile",
          label: t("sales.customers.viewProfile"),
          icon: Eye,
          onSelect: () => router.push(`/sales/customers/${entity.id}`),
        },
      ]}
    />
  );
}

export default function CustomersPage() {
  return (
    <PermissionGate permission="sales.customers.view">
      <CustomersPageContent />
    </PermissionGate>
  );
}
