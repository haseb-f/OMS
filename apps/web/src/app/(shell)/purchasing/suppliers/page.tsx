"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import type { MasterDataFormSection } from "@/components/master-data/master-data-form";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import { EnterpriseButton } from "@/components/ui/button";
import { suppliersService, type SupplierRow } from "@/services/suppliers-service";
import { createMasterDataService } from "@/services/master-data-service";
import type { CurrencyRow, CountryRow } from "@/config/master-data/entities";
import {
  supplierColumns,
  supplierExportColumns,
  supplierRowLabel,
} from "@/config/purchasing/supplier-columns";
import { supplierSchema, supplierDefaultValues } from "@/config/purchasing/supplier-form";
import { useLocale } from "@/providers/locale-provider";
import { PermissionGate } from "@/components/shared/permission-gate";

const currenciesService = createMasterDataService<CurrencyRow>("/currencies");
const countriesService = createMasterDataService<CountryRow>("/countries");

/** Mirrors `sales/customers/page.tsx` (TASK-048) — Supplier's list/create/edit/archive/restore reuse `MasterDataPage`, same as Customer. */
function SuppliersPageContent() {
  const { t } = useLocale();
  const router = useRouter();

  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [countries, setCountries] = useState<CountryRow[]>([]);

  useEffect(() => {
    currenciesService
      .list({ pageSize: 200 })
      .then((r) => setCurrencies(r.items))
      .catch(() => setCurrencies([]));
    countriesService
      .list({ pageSize: 200 })
      .then((r) => setCountries(r.items))
      .catch(() => setCountries([]));
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
          { name: "phone", label: "purchasing.suppliers.fields.phone", type: "text" },
          { name: "mobile", label: "purchasing.suppliers.fields.mobile", type: "text" },
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
            name: "currencyId",
            label: "purchasing.suppliers.fields.currency",
            type: "select",
            options: currencies.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
          },
          { name: "paymentTerm", label: "purchasing.suppliers.fields.paymentTerm", type: "text" },
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
            type: "select",
            options: countries.map((c) => ({ value: c.id, label: c.name })),
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
    [t, currencies, countries],
  );

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
      defaultValues={supplierDefaultValues}
      permissionPrefix="purchasing.suppliers"
      rowLabel={supplierRowLabel}
      extraActions={<ModuleImportButtons importType="SUPPLIERS" />}
      renderRowExtraActions={(entity) => (
        <EnterpriseButton
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/purchasing/suppliers/${entity.id}`)}
        >
          {t("purchasing.suppliers.viewProfile")}
        </EnterpriseButton>
      )}
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
