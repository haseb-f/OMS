"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Contact, Eye, UserPlus } from "lucide-react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import type { MasterDataFormSection } from "@/components/master-data/master-data-form";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import type { RowAction } from "@/components/shared/data-table";
import { leadsService, type LeadRow } from "@/services/leads-service";
import {
  createMasterDataService,
  type MasterDataActivityEntry,
} from "@/services/master-data-service";
import type { CurrencyRow, CountryRow } from "@/config/master-data/entities";
import { leadColumns, leadExportColumns, leadRowLabel } from "@/config/crm/lead-columns";
import { buildLeadSchema, leadDefaultValues } from "@/config/crm/lead-form";
import { useLocale } from "@/providers/locale-provider";
import { PermissionGate } from "@/components/shared/permission-gate";
import { AssignLeadDialog } from "@/components/business/assign-lead-dialog";

const currenciesService = createMasterDataService<CurrencyRow>("/currencies");
const countriesService = createMasterDataService<CountryRow>("/countries");

function CrmLeadsPageContent() {
  const { t } = useLocale();
  const router = useRouter();

  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [countries, setCountries] = useState<CountryRow[]>([]);
  const [assigningLead, setAssigningLead] = useState<LeadRow | null>(null);

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
        title: t("crm.leads.sections.general"),
        columns: 2,
        fields: [
          {
            name: "customerName",
            label: "crm.leads.fields.customerName",
            type: "text",
            required: true,
          },
          {
            name: "countryId",
            label: "crm.leads.fields.country",
            type: "country",
            required: true,
          },
          {
            name: "mobileNumber",
            label: "crm.leads.fields.mobileNumber",
            type: "phone",
            required: true,
            countryFieldName: "countryId",
          },
          { name: "city", label: "crm.leads.fields.city", type: "text", required: true },
          { name: "address", label: "crm.leads.fields.address", type: "text", required: true },
          { name: "quantity", label: "crm.leads.fields.quantity", type: "number", required: true },
          {
            name: "currencyId",
            label: "crm.leads.fields.currency",
            type: "select",
            required: true,
            options: currencies.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
          },
          {
            name: "externalOrderId",
            label: "crm.leads.fields.externalOrderId",
            type: "text",
            description: t("crm.leads.description"),
          },
        ],
      },
    ],
    [t, countries, currencies],
  );

  const leadSchema = useMemo(() => buildLeadSchema(countries, t), [countries, t]);

  return (
    <>
      <MasterDataPage<LeadRow>
        titleKey="crm.leads.title"
        descriptionKey="crm.leads.description"
        breadcrumbKeys={["nav.crm", "nav.crmLeads"]}
        tableId="crm-leads"
        icon={Contact}
        service={{
          ...leadsService,
          activity: (id: string): Promise<MasterDataActivityEntry[]> =>
            leadsService.activities(id).then((rows) =>
              rows.map((row) => ({
                id: row.id,
                entityType: "LEAD",
                entityId: row.leadId,
                type: row.type,
                description: row.description,
                metadata: row.metadata,
                createdAt: row.createdAt,
                createdBy: null,
              })),
            ),
        }}
        columns={leadColumns}
        exportColumnKeys={leadExportColumns}
        formSections={formSections}
        schema={leadSchema}
        phoneCountries={countries}
        defaultValues={leadDefaultValues}
        permissionPrefix="crm.leads"
        rowLabel={leadRowLabel}
        defaultSortBy="createdAt"
        disableArchiveRestore
        extraActions={<ModuleImportButtons importType="LEADS" />}
        extraRowActions={(entity): RowAction[] => [
          {
            key: "view",
            label: t("crm.leads.view"),
            icon: Eye,
            onSelect: () => router.push(`/crm/leads/${entity.id}`),
          },
          {
            key: "assign",
            label: t("crm.leads.assign"),
            icon: UserPlus,
            onSelect: () => setAssigningLead(entity),
          },
        ]}
      />
      <AssignLeadDialog
        open={!!assigningLead}
        onOpenChange={(open) => !open && setAssigningLead(null)}
        leadIds={assigningLead ? [assigningLead.id] : []}
      />
    </>
  );
}

export default function CrmLeadsPage() {
  return (
    <PermissionGate permission="crm.leads.view">
      <CrmLeadsPageContent />
    </PermissionGate>
  );
}
