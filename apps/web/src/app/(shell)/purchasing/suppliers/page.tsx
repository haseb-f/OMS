"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Truck, Eye } from "lucide-react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import type { MasterDataFormSection } from "@/components/master-data/master-data-form";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import type { RowAction } from "@/components/shared/data-table";
import { createRoleScopedPartnerService, type PartnerRow } from "@/services/partners-service";
import {
  supplierPartnerColumns,
  supplierExportColumns,
  partnerRowLabel,
} from "@/config/partners/partner-columns";
import { buildPartnerSchema, partnerDefaultValuesForRole } from "@/config/partners/partner-form";
import { useLocale } from "@/providers/locale-provider";
import { PermissionGate } from "@/components/shared/permission-gate";
import { useCurrencies, useCountries } from "@/hooks/use-reference-data";
import { createMasterDataService } from "@/services/master-data-service";
import type { PaymentTermRow, SupplierGroupRow } from "@/config/master-data/entities";

const paymentTermsService = createMasterDataService<PaymentTermRow>("/payment-terms");
const supplierGroupsService = createMasterDataService<SupplierGroupRow>("/supplier-groups");
const suppliersService = createRoleScopedPartnerService("SUPPLIER");

/** Thin role-filtered view over the Partner registry (Unified Partner Architecture) — "Suppliers" is Partners WHERE role = SUPPLIER, never a separate identity. Mirrors `sales/customers/page.tsx`. */
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
        columns: 3,
        fields: [
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
        columns: 3,
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
        columns: 3,
        fields: [
          { name: "taxNumber", label: "purchasing.suppliers.fields.taxNumber", type: "text" },
          {
            name: "commercialRegistration",
            label: "purchasing.suppliers.fields.commercialRegistration",
            type: "text",
          },
          {
            name: "supplierProfile.supplierGroupId",
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
            name: "supplierProfile.paymentTerm",
            label: "purchasing.suppliers.fields.paymentTerm",
            type: "select",
            options: paymentTerms.map((term) => ({ value: term.name, label: term.name })),
          },
          {
            name: "supplierProfile.creditLimit",
            label: "purchasing.suppliers.fields.creditLimit",
            type: "number",
          },
        ],
      },
      {
        title: t("purchasing.suppliers.sections.addresses"),
        columns: 3,
        fields: [
          {
            name: "countryId",
            label: "purchasing.suppliers.fields.country",
            type: "country",
          },
          { name: "city", label: "purchasing.suppliers.fields.city", type: "text" },
          {
            name: "address",
            label: "purchasing.suppliers.fields.address",
            type: "text",
            span: "full",
          },
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

  const partnerSchema = useMemo(() => buildPartnerSchema(countries, t), [countries, t]);

  return (
    <MasterDataPage<PartnerRow>
      titleKey="purchasing.suppliers.title"
      descriptionKey="purchasing.suppliers.description"
      tableId="purchasing-suppliers"
      icon={Truck}
      service={suppliersService}
      columns={supplierPartnerColumns}
      exportColumnKeys={supplierExportColumns}
      formSections={formSections}
      schema={partnerSchema}
      phoneCountries={countries}
      defaultValues={partnerDefaultValuesForRole("SUPPLIER")}
      permissionPrefix="partners"
      rowLabel={partnerRowLabel}
      getRowHref={(row) => `/purchasing/suppliers/${row.id}`}
      extraListParams={{ role: ["SUPPLIER"] }}
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
    <PermissionGate permission="partners.view">
      <SuppliersPageContent />
    </PermissionGate>
  );
}
