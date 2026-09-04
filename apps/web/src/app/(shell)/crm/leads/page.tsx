"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Contact, Archive, Eye, Plus, UserPlus, Shuffle } from "lucide-react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import type { MasterDataFormSection } from "@/components/master-data/master-data-form";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import { SyncButton } from "@/components/shared/sync-button";
import { EnterpriseButton } from "@/components/ui/button";
import type { RowAction } from "@/components/shared/data-table";
import { leadsService, type LeadRow } from "@/services/leads-service";
import { productsService } from "@/services/products-service";
import { type MasterDataActivityEntry } from "@/services/master-data-service";
import { leadColumns, leadExportColumns, leadRowLabel } from "@/config/crm/lead-columns";
import { buildLeadSchema, leadDefaultValues } from "@/config/crm/lead-form";
import { useLocale } from "@/providers/locale-provider";
import { PermissionGate } from "@/components/shared/permission-gate";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { AssignLeadDialog } from "@/components/business/assign-lead-dialog";
import { LeadOrderCreateDialog } from "@/components/business/lead-order-create-dialog";
import { LeadDistributionModal } from "@/components/crm/lead-distribution-modal";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCurrencies,
  useCountries,
  useCustomerClassifications,
} from "@/hooks/use-reference-data";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

function CrmLeadsPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();
  const classifications = useCustomerClassifications();
  const [canAssign, setCanAssign] = useState(false);

  const currencies = useCurrencies();
  const countries = useCountries();
  const [products, setProducts] = useState<{ id: string; displayName: string; sku: string }[]>([]);
  const [assigningLead, setAssigningLead] = useState<LeadRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<LeadRow | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [distributionOpen, setDistributionOpen] = useState(false);
  const [bulkAssignIds, setBulkAssignIds] = useState<string[]>([]);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [lifecycle, setLifecycle] = useState("active");
  const [classificationFilter, setClassificationFilter] = useState("all");
  const [unassignedCount, setUnassignedCount] = useState<number | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    leadsService
      .unassignedCount()
      .then((r) => setUnassignedCount(r.count))
      .catch(() => setUnassignedCount(null));
    leadsService
      .scope()
      .then((scope) => setCanAssign(scope.canAssign))
      .catch(() => setCanAssign(false));
  }, [refreshToken]);

  useEffect(() => {
    productsService
      .list({ pageSize: 200 })
      .then((r) =>
        setProducts(r.items.map((p) => ({ id: p.id, displayName: p.displayName, sku: p.sku }))),
      )
      .catch(() => setProducts([]));
  }, []);

  const formSections = useMemo<MasterDataFormSection[]>(
    () => [
      {
        title: t("crm.leads.sections.general"),
        columns: 3,
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
          { name: "city", label: "crm.leads.fields.city", type: "text" },
          {
            name: "address",
            label: "crm.leads.fields.address",
            type: "text",
            span: "full",
          },
          {
            name: "productId",
            label: "crm.leads.fields.product",
            type: "select",
            options: products.map((p) => ({ value: p.id, label: `${p.displayName} (${p.sku})` })),
          },
          { name: "quantity", label: "crm.leads.fields.quantity", type: "number" },
          {
            name: "currencyId",
            label: "crm.leads.fields.currency",
            type: "select",
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
    [t, currencies, products],
  );

  const leadSchema = useMemo(() => buildLeadSchema(countries, t), [countries, t]);

  return (
    <>
      <MasterDataPage<LeadRow>
        key={refreshToken}
        titleKey="crm.leads.title"
        descriptionKey="crm.leads.description"
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
        getRowHref={(row) => `/crm/leads/${row.id}`}
        defaultSortBy="createdAt"
        defaultSortOrder="desc"
        disableArchiveRestore
        hideCreateButton
        extraListParams={{
          ...(unassignedOnly ? { unassigned: true } : {}),
          lifecycle,
          ...(classificationFilter !== "all" ? { classificationIds: classificationFilter } : {}),
        }}
        extraFilters={
          <div className="flex flex-wrap items-center gap-3">
            <Select value={lifecycle} onValueChange={setLifecycle}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t("crm.leads.lifecycle.active")}</SelectItem>
                <SelectItem value="converted">{t("crm.leads.lifecycle.converted")}</SelectItem>
                <SelectItem value="closed">{t("crm.leads.lifecycle.closed")}</SelectItem>
                <SelectItem value="all">{t("crm.leads.lifecycle.all")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={classificationFilter} onValueChange={setClassificationFilter}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue placeholder={t("crm.leads.fields.classification")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.select")}</SelectItem>
                {classifications.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-caption">
              <Checkbox
                checked={unassignedOnly}
                onCheckedChange={(value) => setUnassignedOnly(value === true)}
              />
              {t("crm.leads.distribution.unassigned")}
              {unassignedCount !== null ? ` (${unassignedCount})` : ""}
            </label>
          </div>
        }
        extraBulkActions={(ids) =>
          canAssign ? (
            <EnterpriseButton
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setBulkAssignIds(ids);
                setDistributionOpen(true);
              }}
            >
              {t("crm.leads.actions.assign")}
            </EnterpriseButton>
          ) : null
        }
        extraActions={
          <>
            {canAssign ? (
              <EnterpriseButton
                type="button"
                variant="outline"
                onClick={() => setDistributionOpen(true)}
              >
                <Shuffle />
                {t("crm.leads.distribution.action")}
              </EnterpriseButton>
            ) : null}
            <SyncButton sourceType="LEADS" onSynced={() => setRefreshToken((n) => n + 1)} />
            <ModuleImportButtons
              importType="LEADS"
              onImported={() => setRefreshToken((n) => n + 1)}
            />
            <EnterpriseButton type="button" onClick={() => setCreateDialogOpen(true)}>
              <Plus />
              {t("masterData.actions.addNew")}
            </EnterpriseButton>
          </>
        }
        extraRowActions={(entity): RowAction[] => [
          {
            key: "view",
            label: t("common.view"),
            icon: Eye,
            hidden: !hasPermission("crm.leads.view"),
            onSelect: () => router.push(`/crm/leads/${entity.id}`),
          },
          {
            key: "assign",
            label: t("crm.leads.assign"),
            icon: UserPlus,
            hidden: !canAssign,
            onSelect: () => setAssigningLead(entity),
          },
          {
            key: "archive",
            label: t("common.archive"),
            icon: Archive,
            hidden: !hasPermission("crm.leads.archive") || entity.status?.code === "LOST",
            destructive: true,
            separatorBefore: true,
            onSelect: () => setArchiveTarget(entity),
          },
        ]}
      />
      <LeadDistributionModal
        open={distributionOpen}
        onOpenChange={(open) => {
          setDistributionOpen(open);
          if (!open) setBulkAssignIds([]);
        }}
        selectedLeadIds={bulkAssignIds}
        onChanged={() => setRefreshToken((n) => n + 1)}
      />
      <AssignLeadDialog
        open={!!assigningLead}
        onOpenChange={(open) => !open && setAssigningLead(null)}
        leadIds={assigningLead ? [assigningLead.id] : []}
      />
      <LeadOrderCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        icon={Contact}
        countries={countries}
        onCreated={() => setRefreshToken((n) => n + 1)}
      />
      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        tone="destructive"
        title={t("common.confirmArchiveTitle")}
        description={t("common.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.cancel")}
        isConfirming={isArchiving}
        onConfirm={async () => {
          if (!archiveTarget) return;
          setIsArchiving(true);
          try {
            await leadsService.archiveLead(archiveTarget.id);
            toast.success(t("common.archive"));
            setArchiveTarget(null);
            setRefreshToken((n) => n + 1);
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
          } finally {
            setIsArchiving(false);
          }
        }}
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
