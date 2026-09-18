"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Contact, Archive, Eye, Plus, UserPlus, Workflow, Download } from "lucide-react";
import { MasterDataPage } from "@/components/master-data/master-data-page";
import type { MasterDataFormSection } from "@/components/master-data/master-data-form";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import { SyncButton } from "@/components/shared/sync-button";
import { EnterpriseButton } from "@/components/ui/button";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { exportRowsToCsv } from "@/components/master-data/enterprise-data-table";
import type { RowAction } from "@/components/shared/data-table";
import { leadsService, type LeadRow } from "@/services/leads-service";
import { type MasterDataActivityEntry } from "@/services/master-data-service";
import {
  leadColumns,
  leadExportColumns,
  leadExportRow,
  leadExportSelectedColumns,
  leadRowLabel,
} from "@/config/crm/lead-columns";
import { buildLeadSchema, leadDefaultValues } from "@/config/crm/lead-form";
import { useLocale } from "@/providers/locale-provider";
import { PermissionGate } from "@/components/shared/permission-gate";
import { LeadCloseWithoutPurchaseDialog } from "@/components/crm/lead-close-dialog";
import { AssignLeadDialog } from "@/components/business/assign-lead-dialog";
import { LeadOrderCreateDialog } from "@/components/business/lead-order-create-dialog";
import { LeadDistributionModal } from "@/components/crm/lead-distribution-modal";
import { LeadDistributionControl } from "@/components/crm/lead-distribution-control";
import { BulkLeadStatusDialog } from "@/components/crm/bulk-lead-status-dialog";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
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

function CrmLeadsPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();
  const classifications = useCustomerClassifications();
  const [canAssign, setCanAssign] = useState(false);

  const currencies = useCurrencies();
  const countries = useCountries();
  const [assigningLead, setAssigningLead] = useState<LeadRow | null>(null);
  const [closeTarget, setCloseTarget] = useState<LeadRow | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [distributionOpen, setDistributionOpen] = useState(false);
  const [bulkAssignIds, setBulkAssignIds] = useState<string[]>([]);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatusIds, setBulkStatusIds] = useState<string[]>([]);
  const [isExportingSelected, setIsExportingSelected] = useState(false);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [lifecycle, setLifecycle] = useState("active");
  const [classificationFilter, setClassificationFilter] = useState("all");
  const [followUpFilter, setFollowUpFilter] = useState("all");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [eligibleEmployees, setEligibleEmployees] = useState<
    { id: string; fullName: string; email: string }[]
  >([]);
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
    // Employee filter (Smart Selection) — reuses the same canonical,
    // scope-aware eligible-assignee source the Reassign dialog already
    // uses. Backend requires `assertCanAssign` for this endpoint, so an
    // OWN-scope Sales Agent (canAssign === false) never even calls it —
    // this filter is simply absent for them, never a cross-employee leak.
    if (!canAssign) {
      setEligibleEmployees([]);
      return;
    }
    leadsService
      .eligibleAssignees()
      .then(setEligibleEmployees)
      .catch(() => setEligibleEmployees([]));
  }, [canAssign, refreshToken]);

  /**
   * Smart Selection "Export Selected" — the selection itself may be a bare
   * server-side id set (all-filtered/custom-N never loads full records into
   * the browser just to build a count), so export re-fetches the exact
   * selected rows by id (still AND-ed with scope server-side — never a
   * bypass) rather than depending on whatever page data happens to be
   * cached client-side.
   */
  const handleExportSelected = async (ids: string[]) => {
    if (ids.length === 0) return;
    setIsExportingSelected(true);
    try {
      const result = await leadsService.list({ ids, pageSize: ids.length });
      exportRowsToCsv(
        result.items.map((item) => leadExportRow(item)),
        leadExportSelectedColumns,
        "leads-selected.csv",
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsExportingSelected(false);
    }
  };

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
            type: "product",
            sellableOnly: true,
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
    [t, currencies],
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
        supportsSelectAllMatching
        selectCustomCountCopy={{
          title: t("crm.leads.bulkSelection.customCountTitle"),
          countLabel: t("crm.leads.bulkSelection.customCountLabel"),
          hint: (count) => t("crm.leads.bulkSelection.customCountHint", { count }),
          confirmLabel: t("crm.leads.bulkSelection.customCountConfirm"),
          invalidMessage: t("crm.leads.bulkSelection.customCountInvalid"),
        }}
        extraListParams={{
          ...(unassignedOnly ? { unassigned: true } : {}),
          ...(employeeFilter ? { salesEmployeeId: employeeFilter } : {}),
          lifecycle,
          ...(classificationFilter !== "all" ? { classificationIds: classificationFilter } : {}),
          ...(followUpFilter !== "all" ? { followUpFilter } : {}),
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
            <Select value={followUpFilter} onValueChange={setFollowUpFilter}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue placeholder={t("crm.leads.filters.followUp")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("crm.leads.filters.followUpAll")}</SelectItem>
                <SelectItem value="today">{t("crm.leads.followUp.today")}</SelectItem>
                <SelectItem value="overdue">{t("crm.leads.followUp.overdue")}</SelectItem>
                <SelectItem value="upcoming">{t("crm.leads.filters.followUpUpcoming")}</SelectItem>
                <SelectItem value="none">{t("crm.leads.filters.followUpNone")}</SelectItem>
              </SelectContent>
            </Select>
            {/* Employee filter — Section 8: only ever rendered for a scope
                that's authorized to see other employees' Leads at all
                (canAssign === ALL/TEAM). An OWN-scope Sales Agent gets no
                such control, so they can never even attempt to filter by
                another employee — the backend AND's this with scope
                regardless, but hiding it here keeps the UI honest too. */}
            {canAssign ? (
              <EntityCombobox
                items={eligibleEmployees}
                value={eligibleEmployees.find((employee) => employee.id === employeeFilter) ?? null}
                onChange={(employee) => setEmployeeFilter(employee?.id ?? "")}
                getId={(employee) => employee.id}
                getTitle={(employee) => employee.fullName}
                getSearchText={(employee) => employee.email}
                placeholder={t("crm.leads.filters.employee")}
                searchPlaceholder={t("common.search")}
                allowClear
                triggerClassName="h-(--control-height-sm) w-52"
              />
            ) : null}
            {canAssign ? (
              <label className="flex items-center gap-2 text-caption">
                <Checkbox
                  checked={unassignedOnly}
                  onCheckedChange={(value) => setUnassignedOnly(value === true)}
                />
                {t("crm.leads.distribution.unassigned")}
                {unassignedCount !== null ? ` (${unassignedCount})` : ""}
              </label>
            ) : null}
          </div>
        }
        extraBulkActions={(ids) => (
          <>
            {canAssign ? (
              <EnterpriseButton
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setBulkAssignIds(ids);
                  setDistributionOpen(true);
                }}
              >
                <UserPlus className="size-3.5" />
                {t("crm.leads.actions.assign")}
              </EnterpriseButton>
            ) : null}
            <EnterpriseButton
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setBulkStatusIds(ids);
                setBulkStatusOpen(true);
              }}
            >
              <Workflow className="size-3.5" />
              {t("crm.leads.bulkStatus.action")}
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              size="sm"
              variant="outline"
              disabled={isExportingSelected}
              onClick={() => void handleExportSelected(ids)}
            >
              <Download className="size-3.5" />
              {t("crm.leads.actions.exportSelected")}
            </EnterpriseButton>
          </>
        )}
        extraActions={
          <>
            {canAssign ? (
              <LeadDistributionControl
                onOpenModes={() => setDistributionOpen(true)}
                onChanged={() => setRefreshToken((n) => n + 1)}
              />
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
            key: "close-without-purchase",
            label: t("crm.leads.actions.closeWithoutPurchase"),
            icon: Archive,
            // Matches the Lead Detail page's own gate exactly — same
            // permission (crm.leads.edit) the backend route requires, same
            // terminal-status set. This row action used to be a generic
            // "Archive" wired to the legacy POST :id/archive endpoint
            // (crm.leads.archive, a different permission than the backend
            // actually checked) with no NoPurchaseReason — closing a Lead
            // now only ever happens through this one reason-driven dialog.
            hidden:
              !hasPermission("crm.leads.edit") ||
              entity.status?.code === "LOST" ||
              entity.status?.code === "DISQUALIFIED" ||
              entity.status?.code === "CONVERTED",
            destructive: true,
            separatorBefore: true,
            onSelect: () => setCloseTarget(entity),
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
      <BulkLeadStatusDialog
        open={bulkStatusOpen}
        onOpenChange={(open) => {
          setBulkStatusOpen(open);
          if (!open) setBulkStatusIds([]);
        }}
        selectedIds={bulkStatusIds}
        onChanged={() => setRefreshToken((n) => n + 1)}
      />
      <AssignLeadDialog
        open={!!assigningLead}
        onOpenChange={(open) => !open && setAssigningLead(null)}
        leadIds={assigningLead ? [assigningLead.id] : []}
        onAssigned={() => setRefreshToken((n) => n + 1)}
      />
      <LeadOrderCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        icon={Contact}
        countries={countries}
        onCreated={() => setRefreshToken((n) => n + 1)}
      />
      <LeadCloseWithoutPurchaseDialog
        leadId={closeTarget?.id ?? ""}
        classificationId={closeTarget?.customerClassification?.id ?? null}
        open={!!closeTarget}
        onOpenChange={(open) => {
          if (!open) setCloseTarget(null);
        }}
        onClosed={() => {
          setCloseTarget(null);
          setRefreshToken((n) => n + 1);
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
