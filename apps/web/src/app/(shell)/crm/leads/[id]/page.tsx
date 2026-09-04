"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CalendarClock, FileText, ShoppingCart, UserCheck } from "lucide-react";
import {
  DetailField,
  DetailFieldGrid,
  DetailSection,
  DetailWorkspace,
} from "@/components/shared/detail-workspace";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { EnterpriseButton } from "@/components/ui/button";
import { EntityTabs } from "@/components/business/entity-tabs";
import { DynamicStatusBadge } from "@/components/business/dynamic-status-badge";
import { ClassificationBadge } from "@/components/business/classification-badge";
import { WorkflowActionsPanel } from "@/components/business/workflow-actions-panel";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { AssignLeadDialog } from "@/components/business/assign-lead-dialog";
import { LeadFollowUpDialog } from "@/components/crm/lead-follow-up-dialog";
import { LeadConvertDialog } from "@/components/crm/lead-convert-dialog";
import { LeadCloseWithoutPurchaseDialog } from "@/components/crm/lead-close-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PermissionGate } from "@/components/shared/permission-gate";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { Textarea } from "@/components/ui/textarea";
import {
  leadsService,
  type LeadRow,
  type LeadActivityRow,
  type LeadAssignmentRow,
  type LeadFollowUpRow,
  type LeadNoteRow,
} from "@/services/leads-service";
import { useCustomerClassifications } from "@/hooks/use-reference-data";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDate, formatDateTime } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

function LeadDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const classifications = useCustomerClassifications();

  const [lead, setLead] = useState<LeadRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activities, setActivities] = useState<LeadActivityRow[] | null>(null);
  const [assignments, setAssignments] = useState<LeadAssignmentRow[] | null>(null);
  const [followUps, setFollowUps] = useState<LeadFollowUpRow[] | null>(null);
  const [notes, setNotes] = useState<LeadNoteRow[] | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [canAssign, setCanAssign] = useState(false);

  const canEdit = hasPermission("crm.leads.edit");
  const canConvert = hasPermission("crm.leads.convert") || canEdit;
  const operational =
    lead &&
    lead.status?.code !== "CONVERTED" &&
    lead.status?.code !== "LOST" &&
    lead.status?.code !== "DISQUALIFIED";

  useBreadcrumbLabel(lead?.leadNumber ?? null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const loaded = await leadsService.get(params.id);
      setLead(loaded);
      if (loaded.status?.code === "NEW") {
        setLead(await leadsService.firstOpen(params.id));
      }
    } catch {
      setLead(null);
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    leadsService
      .scope()
      .then((scope) => setCanAssign(scope.canAssign))
      .catch(() => setCanAssign(false));
  }, []);

  const reloadSidePanels = useCallback(() => {
    leadsService
      .activities(params.id)
      .then(setActivities)
      .catch(() => setActivities([]));
    leadsService
      .assignments(params.id)
      .then(setAssignments)
      .catch(() => setAssignments([]));
    leadsService
      .followUps(params.id)
      .then(setFollowUps)
      .catch(() => setFollowUps([]));
    leadsService
      .notes(params.id)
      .then(setNotes)
      .catch(() => setNotes([]));
  }, [params.id]);

  useEffect(() => {
    reloadSidePanels();
  }, [reloadSidePanels]);

  const submitNote = async () => {
    if (!noteDraft.trim()) return;
    setIsSavingNote(true);
    try {
      await leadsService.addNote(params.id, noteDraft.trim());
      setNoteDraft("");
      leadsService
        .notes(params.id)
        .then(setNotes)
        .catch(() => setNotes([]));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
    } finally {
      setIsSavingNote(false);
    }
  };

  const saveClassification = async (id: string | null) => {
    if (!lead) return;
    try {
      const updated = await leadsService.update(lead.id, {
        customerClassificationId: id,
      } as never);
      setLead(updated);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-2">
        <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }
  if (!lead) {
    return (
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-2">
        <EmptyState icon={FileText} title={t("common.noResults")} />
      </div>
    );
  }

  const timelineEntries: TimelineEntry[] = (activities ?? []).map((entry) => ({
    id: entry.id,
    title: entry.description,
    timestamp: formatDateTime(entry.createdAt),
    status:
      entry.type === "ARCHIVED" ? "rejected" : entry.type === "LEAD_CREATED" ? "done" : "pending",
  }));

  const selectedClassification =
    classifications.find((row) => row.id === lead.customerClassificationId) ??
    (lead.customerClassification
      ? {
          ...lead.customerClassification,
          description: null,
          sortOrder: 0,
          isActive: lead.customerClassification.isActive,
        }
      : null);

  return (
    <DetailWorkspace
      title={lead.leadNumber}
      subtitle={lead.customerName}
      status={
        <div className="flex flex-wrap items-center gap-1.5">
          <DynamicStatusBadge label={lead.status?.name ?? "—"} colorKey={lead.status?.color} />
          {lead.customerClassification ? (
            <ClassificationBadge
              label={lead.customerClassification.name}
              color={lead.customerClassification.color}
            />
          ) : null}
          {lead.possibleDuplicate ? (
            <DynamicStatusBadge label={t("crm.leads.possibleDuplicate")} colorKey="warning" />
          ) : null}
        </div>
      }
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          {canConvert && operational ? (
            <EnterpriseButton size="sm" variant="success" onClick={() => setConvertOpen(true)}>
              <ShoppingCart />
              {t("crm.leads.convert.cta")}
            </EnterpriseButton>
          ) : null}
          {canEdit && operational ? (
            <EnterpriseButton size="sm" variant="outline" onClick={() => setFollowUpOpen(true)}>
              <CalendarClock />
              {t("crm.leads.actions.addFollowUp")}
            </EnterpriseButton>
          ) : null}
          {canAssign && operational ? (
            <EnterpriseButton size="sm" variant="outline" onClick={() => setAssignOpen(true)}>
              <UserCheck />
              {lead.salesEmployee ? t("crm.leads.actions.transfer") : t("crm.leads.actions.assign")}
            </EnterpriseButton>
          ) : null}
          {canEdit && operational ? (
            <EnterpriseButton size="sm" variant="outline" onClick={() => setCloseOpen(true)}>
              {t("crm.leads.actions.closeWithoutPurchase")}
            </EnterpriseButton>
          ) : null}
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <DetailField
          label={t("crm.leads.fields.assignedTo")}
          value={lead.salesEmployee?.fullName}
        />
        <DetailField
          label={t("crm.leads.fields.nextFollowUp")}
          value={lead.nextFollowUpAt ? formatDateTime(lead.nextFollowUpAt) : undefined}
        />
        <DetailField
          label={t("crm.leads.fields.classification")}
          value={
            canEdit && operational ? (
              <EntityCombobox
                value={selectedClassification}
                onChange={(row) => void saveClassification(row?.id ?? null)}
                items={[
                  ...(lead.customerClassification &&
                  lead.customerClassification.deletedAt &&
                  !classifications.some((row) => row.id === lead.customerClassification!.id)
                    ? [lead.customerClassification as never]
                    : []),
                  ...classifications,
                ]}
                getId={(row) => row.id}
                getTitle={(row) => row.name}
                allowClear
                placeholder={t("masterData.customerClassifications.select")}
              />
            ) : lead.customerClassification ? (
              <ClassificationBadge
                label={lead.customerClassification.name}
                color={lead.customerClassification.color}
              />
            ) : undefined
          }
        />
      </div>

      {lead.storeOrder ? (
        <p className="text-body">
          {t("crm.leads.convert.convertedTo")}{" "}
          <EnterpriseButton
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto p-0 font-medium"
            onClick={() => router.push(`/store-orders/${lead.storeOrder!.id}`)}
          >
            {lead.storeOrder.internalOrderId}
          </EnterpriseButton>
        </p>
      ) : null}

      {operational ? (
        <WorkflowActionsPanel
          entityType="LEAD"
          entityId={lead.id}
          hideConvert
          onTransitionComplete={() => {
            void load();
            reloadSidePanels();
          }}
        />
      ) : null}

      <EntityTabs
        tabs={[
          {
            value: "general",
            label: t("crm.leads.sections.general"),
            content: (
              <DetailSection>
                <DetailFieldGrid>
                  <DetailField
                    label={t("crm.leads.fields.mobileNumber")}
                    value={lead.mobileNumber}
                  />
                  <DetailField label={t("crm.leads.fields.country")} value={lead.country?.name} />
                  <DetailField label={t("crm.leads.fields.city")} value={lead.city} />
                  <DetailField label={t("crm.leads.fields.address")} value={lead.address} />
                  <DetailField
                    label={t("crm.leads.fields.source")}
                    value={t(`crm.leads.source.${lead.source}` as MessageKey)}
                  />
                  <DetailField
                    label={t("crm.leads.fields.createdAt")}
                    value={formatDate(lead.createdAt)}
                  />
                  {lead.noPurchaseReason ? (
                    <DetailField
                      label={t("crm.leads.fields.noPurchaseReason")}
                      value={lead.noPurchaseReason.name}
                    />
                  ) : null}
                </DetailFieldGrid>
              </DetailSection>
            ),
          },
          {
            value: "followUps",
            label: t("crm.leads.sections.followUps"),
            content: (
              <DetailSection>
                {(followUps ?? []).length === 0 ? (
                  <p className="text-caption text-muted-foreground">{t("common.noResults")}</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {(followUps ?? []).map((item) => (
                      <div
                        key={item.id}
                        className="border-t border-border pt-2 first:border-t-0 first:pt-0"
                      >
                        <p className="text-body font-medium">{item.outcome || "—"}</p>
                        {item.note ? <p className="text-caption">{item.note}</p> : null}
                        <p className="text-caption text-muted-foreground">
                          {item.user?.fullName} · {formatDateTime(item.createdAt)}
                          {item.followUpAt
                            ? ` · ${t("crm.leads.fields.nextFollowUp")}: ${formatDateTime(item.followUpAt)}`
                            : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </DetailSection>
            ),
          },
          {
            value: "timeline",
            label: t("crm.leads.sections.timeline"),
            content:
              activities === null ? (
                <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
              ) : timelineEntries.length === 0 ? (
                <p className="text-caption text-muted-foreground">{t("common.noActivity")}</p>
              ) : (
                <AuditTimeline entries={timelineEntries} />
              ),
          },
          {
            value: "assignment",
            label: t("crm.leads.sections.assignment"),
            content: (
              <DetailSection>
                <DetailField
                  label={t("crm.leads.fields.assignedTo")}
                  value={
                    lead.salesEmployee
                      ? `${lead.salesEmployee.fullName} — ${lead.salesEmployee.email}`
                      : undefined
                  }
                />
                {(assignments ?? []).map((assignment) => (
                  <p key={assignment.id} className="text-caption text-muted-foreground">
                    {formatDateTime(assignment.assignedAt)} · {assignment.assignedTo?.fullName} ·{" "}
                    {assignment.method}
                  </p>
                ))}
              </DetailSection>
            ),
          },
          {
            value: "notes",
            label: t("crm.leads.sections.notes"),
            content: (
              <DetailSection>
                <div className="flex flex-col gap-2">
                  <Textarea
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    placeholder={t("crm.leads.notesPanel.placeholder")}
                  />
                  <EnterpriseButton
                    type="button"
                    size="sm"
                    className="w-fit"
                    disabled={isSavingNote || !noteDraft.trim()}
                    onClick={() => void submitNote()}
                  >
                    {t("crm.leads.actions.addNote")}
                  </EnterpriseButton>
                </div>
                {(notes ?? []).map((note) => (
                  <div key={note.id} className="border-t border-border pt-3">
                    <p className="whitespace-pre-wrap text-sm">{note.text}</p>
                    <p className="pt-1 text-caption text-muted-foreground">
                      {formatDateTime(note.createdAt)}
                    </p>
                  </div>
                ))}
              </DetailSection>
            ),
          },
        ]}
      />

      <LeadFollowUpDialog
        open={followUpOpen}
        onOpenChange={setFollowUpOpen}
        leadId={lead.id}
        onSaved={() => {
          void load();
          reloadSidePanels();
        }}
      />
      <LeadConvertDialog
        lead={lead}
        open={convertOpen}
        onOpenChange={setConvertOpen}
        onConverted={(result) => {
          if (result.storeOrder?.id) {
            router.push(`/store-orders/${result.storeOrder.id}`);
            return;
          }
          void load();
        }}
      />
      <LeadCloseWithoutPurchaseDialog
        leadId={lead.id}
        classificationId={lead.customerClassificationId}
        open={closeOpen}
        onOpenChange={setCloseOpen}
        onClosed={() => {
          void load();
          reloadSidePanels();
        }}
      />
      <AssignLeadDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        leadIds={[lead.id]}
        onAssigned={() => {
          void load();
          reloadSidePanels();
        }}
      />
    </DetailWorkspace>
  );
}

export default function LeadDetailPage() {
  return (
    <PermissionGate permission="crm.leads.view">
      <LeadDetailContent />
    </PermissionGate>
  );
}
