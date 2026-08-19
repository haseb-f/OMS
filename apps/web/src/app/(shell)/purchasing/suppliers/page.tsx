"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Truck, Eye } from "lucide-react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import type { MasterDataFormSection } from "@/components/master-data/master-data-form";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import type { RowAction } from "@/components/shared/data-table";
import { suppliersService, type SupplierRow } from "@/services/suppliers-service";
import {
  supplierColumns,
  supplierExportColumns,
  supplierRowLabel,
} from "@/config/purchasing/supplier-columns";
import { buildSupplierSchema, supplierDefaultValues } from "@/config/purchasing/supplier-form";
import { useLocale } from "@/providers/locale-provider";
import { PermissionGate } from "@/components/shared/permission-gate";
import { useCurrencies, useCountries } from "@/hooks/use-reference-data";
import { createMasterDataService } from "@/services/master-data-service";
import type { PaymentTermRow, SupplierGroupRow } from "@/config/master-data/entities";

const paymentTermsService = createMasterDataService<PaymentTermRow>("/payment-terms");
const supplierGroupsService = createMasterDataService<SupplierGroupRow>("/supplier-groups");

/** Mirrors `sales/customers/page.tsx` (TASK-048) — Supplier's list/create/edit/archive/restore reuse `MasterDataPage`, same as Customer. */
function SuppliersPageContent() {
  const { t } = useLocale();
  const router = useRouter();

  const currencies = useCurrencies();
  const countries = useCountries();
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermRow[]>([]);
  const [supplierGroups, setSupplierGroups] = useState<SupplierGroupRow[]>([]);

  useEffect(() => {
    paymentTermsService
      .list({ pageSize: 200 })
      .then((result) => setPaymentTerms(result.items))
      .catch(() => setPaymentTerms([]));
    supplierGroupsService
      .list({ pageSize: 200 })
      .then((result) => setSupplierGroups(result.items))
      .catch(() => setSupplierGroups([]));
  }, []);

  const formSections = useMemo<MasterDataFormSection[]>(
    () => [
      {
        title: t("purchasing.suppliers.sections.general"),
        columns: 2,
        fields: [
          { name: "code", label: "purchasing.suppliers.fields.code", type: "text" },
          { name: "name", label: "purchasing.suppliers.fields.name", type: "text", required: true },
          {
            name: "commercialName",
            label: "purchasing.suppliers.fields.commercialName",
            type: "text",
          },
        ],
      },
      {
        title: t("purchasing.suppliers.sections.contact"),
        columns: 2,
        fields: [
          {
            name: "phone",
            label: "purchasing.suppliers.fields.phone",
            type: "phone",
            countryFieldName: "countryId",
          },
          {
            name: "mobile",
            label: "purchasing.suppliers.fields.mobile",
            type: "phone",
            countryFieldName: "countryId",
          },
          { name: "email", label: "purchasing.suppliers.fields.email", type: "text" },
          { name: "website", label: "purchasing.suppliers.fields.website", type: "text" },
        ],
      },
      {
        title: t("purchasing.suppliers.sections.commercial"),
        columns: 2,
        fields: [
          { name: "taxNumber", label: "purchasing.suppliers.fields.taxNumber", type: "text" },
          {
            name: "commercialRegistration",
            label: "purchasing.suppliers.fields.commercialRegistration",
            type: "text",
          },
          {
            name: "supplierGroupId",
            label: "purchasing.suppliers.fields.supplierGroup",
            type: "select",
            options: supplierGroups.map((group) => ({ value: group.id, label: group.name })),
          },
          {
            name: "currencyId",
            label: "purchasing.suppliers.fields.currency",
            type: "select",
            options: currencies.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
          },
          {
            name: "paymentTerm",
            label: "purchasing.suppliers.fields.paymentTerm",
            type: "select",
            options: paymentTerms.map((term) => ({ value: term.name, label: term.name })),
          },
          { name: "creditLimit", label: "purchasing.suppliers.fields.creditLimit", type: "number" },
        ],
      },
      {
        title: t("purchasing.suppliers.sections.addresses"),
        columns: 2,
        fields: [
          {
            name: "countryId",
            label: "purchasing.suppliers.fields.country",
            type: "country",
          },
          { name: "city", label: "purchasing.suppliers.fields.city", type: "text" },
          { name: "address", label: "purchasing.suppliers.fields.address", type: "text" },
        ],
      },
      {
        title: t("purchasing.suppliers.sections.notes"),
        columns: 2,
        fields: [{ name: "notes", label: "purchasing.suppliers.fields.notes", type: "textarea" }],
      },
    ],
    [t, currencies, paymentTerms, supplierGroups],
  );

  const supplierSchema = useMemo(() => buildSupplierSchema(countries, t), [countries, t]);

  return (
    <MasterDataPage<SupplierRow>
      titleKey="purchasing.suppliers.title"
      descriptionKey="purchasing.suppliers.description"
      breadcrumbKeys={["nav.purchasing", "purchasing.suppliers.title"]}
      tableId="purchasing-suppliers"
      icon={Truck}
      service={suppliersService}
      columns={supplierColumns}
      exportColumnKeys={supplierExportColumns}
      formSections={formSections}
      schema={supplierSchema}
      phoneCountries={countries}
      defaultValues={supplierDefaultValues}
      permissionPrefix="purchasing.suppliers"
      rowLabel={supplierRowLabel}
      extraActions={<ModuleImportButtons importType="SUPPLIERS" />}
      extraRowActions={(entity): RowAction[] => [
        {
          key: "view-profile",
          label: t("common.view"),
          icon: Eye,
          onSelect: () => router.push(`/purchasing/suppliers/${entity.id}`),
        },
      ]}
    />
  );
}

export default function SuppliersPage() {
  return (
    <PermissionGate permission="purchasing.suppliers.view">
      <SuppliersPageContent />
    </PermissionGate>
  );
}
