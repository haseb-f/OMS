"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Archive, FileText, UserCheck } from "lucide-react";
import {
  DetailField,
  DetailFieldGrid,
  DetailSection,
  DetailWorkspace,
} from "@/components/shared/detail-workspace";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { RowActionsMenu } from "@/components/shared/data-table";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { EnterpriseButton } from "@/components/ui/button";
import { EntityTabs } from "@/components/business/entity-tabs";
import { StatusBadge } from "@/components/business/status-badge";
import { WorkflowActionsPanel } from "@/components/business/workflow-actions-panel";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { AssignLeadDialog } from "@/components/business/assign-lead-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PermissionGate } from "@/components/shared/permission-gate";
import { Textarea } from "@/components/ui/textarea";
import {
  leadsService,
  type LeadRow,
  type LeadActivityRow,
  type LeadAssignmentRow,
  type LeadNoteRow,
} from "@/services/leads-service";
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

  const [lead, setLead] = useState<LeadRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activities, setActivities] = useState<LeadActivityRow[] | null>(null);
  const [assignments, setAssignments] = useState<LeadAssignmentRow[] | null>(null);
  const [notes, setNotes] = useState<LeadNoteRow[] | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const canEdit = hasPermission("crm.leads.edit");
  const canManage = hasPermission("crm.leads.manage");
  const canArchive = hasPermission("crm.leads.archive");

  useBreadcrumbLabel(lead?.leadNumber ?? null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setLead(await leadsService.get(params.id));
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
      .notes(params.id)
      .then(setNotes)
      .catch(() => setNotes([]));
  }, [params.id]);

  useEffect(() => {
    reloadSidePanels();
  }, [reloadSidePanels]);

  const runTransition = async (action: () => Promise<unknown>) => {
    try {
      await action();
      toast.success(t("common.save"));
      await load();
      reloadSidePanels();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    }
  };

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
      toast.error(error instanceof ApiError ? error.message : "Failed to add note.");
    } finally {
      setIsSavingNote(false);
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

  return (
    <DetailWorkspace
      title={lead.leadNumber}
      status={
        <>
          {lead.possibleDuplicate ? (
            <StatusBadge tone="warning" label={t("crm.leads.possibleDuplicate")} />
          ) : null}
        </>
      }
      actions={
        <RowActionsMenu
          label={t("common.actions")}
          actions={[
            {
              key: "assign",
              label: t("crm.leads.actions.reassign"),
              icon: UserCheck,
              hidden: !canManage,
              onSelect: () => setAssignOpen(true),
            },
            {
              key: "archive",
              label: t("crm.leads.actions.archive"),
              icon: Archive,
              hidden: !canArchive || lead.status?.code === "LOST",
              destructive: true,
              separatorBefore: true,
              onSelect: () => setArchiveOpen(true),
            },
          ]}
        />
      }
    >
      <DetailSection title={t("workflow.actions.title")}>
        <WorkflowActionsPanel
          entityType="LEAD"
          entityId={lead.id}
          currentStatus={lead.status}
          onTransitionComplete={() => {
            void load();
            reloadSidePanels();
          }}
          convertDefaults={{
            productId: lead.productId ?? undefined,
            quantity: lead.quantity,
          }}
        />
      </DetailSection>
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
                    label={t("crm.leads.fields.product")}
                    value={lead.product?.displayName ?? lead.product?.name}
                  />
                  <DetailField
                    label={t("crm.leads.fields.quantity")}
                    value={String(lead.quantity)}
                  />
                  <DetailField
                    label={t("crm.leads.fields.currency")}
                    value={
                      lead.currency ? `${lead.currency.code} — ${lead.currency.name}` : undefined
                    }
                  />
                  <DetailField
                    label={t("crm.leads.fields.externalOrderId")}
                    value={lead.externalOrderId}
                  />
                  <DetailField
                    label={t("crm.leads.fields.source")}
                    value={t(`crm.leads.source.${lead.source}` as MessageKey)}
                  />
                  <DetailField
                    label={t("crm.leads.fields.createdAt")}
                    value={formatDate(lead.createdAt)}
                  />
                  <DetailField
                    label={t("crm.leads.fields.customer")}
                    value={
                      lead.partner ? (
                        <EnterpriseButton
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto justify-start p-0 text-body font-medium"
                          onClick={() => router.push(`/sales/customers/${lead.partner!.id}`)}
                        >
                          {lead.partner.partnerNumber} — {lead.partner.name}
                        </EnterpriseButton>
                      ) : (
                        t("crm.leads.noCustomerLinked")
                      )
                    }
                  />
                  {lead.storeOrder ? (
                    <DetailField
                      label={t("workflow.fields.storeOrder")}
                      value={
                        <EnterpriseButton
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto justify-start p-0 text-body font-medium"
                          onClick={() => router.push(`/store-orders/${lead.storeOrder!.id}`)}
                        >
                          {lead.storeOrder.internalOrderId}
                        </EnterpriseButton>
                      }
                    />
                  ) : null}
                </DetailFieldGrid>
              </DetailSection>
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
                {assignments === null ? (
                  <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
                ) : assignments.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {assignments.map((assignment) => (
                      <p key={assignment.id} className="text-caption text-muted-foreground">
                        {formatDateTime(assignment.assignedAt)}
                      </p>
                    ))}
                  </div>
                ) : null}
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
                    onClick={submitNote}
                  >
                    {t("crm.leads.actions.addNote")}
                  </EnterpriseButton>
                </div>
                <div className="flex flex-col gap-3">
                  {notes === null ? (
                    <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
                  ) : notes.length === 0 ? (
                    <p className="text-caption text-muted-foreground">
                      {t("crm.leads.notesPanel.empty")}
                    </p>
                  ) : (
                    notes.map((note) => (
                      <div key={note.id} className="border-t border-border pt-3">
                        <p className="whitespace-pre-wrap text-sm">{note.text}</p>
                        <p className="pt-1 text-caption text-muted-foreground">
                          {formatDateTime(note.createdAt)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </DetailSection>
            ),
          },
        ]}
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

      <ConfirmationDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        tone="destructive"
        title={t("common.confirmArchiveTitle")}
        description={t("common.confirmArchiveDescription")}
        confirmLabel={t("crm.leads.actions.archive")}
        cancelLabel={t("common.cancel")}
        isConfirming={isArchiving}
        onConfirm={() => {
          setIsArchiving(true);
          void runTransition(() => leadsService.archiveLead(lead.id)).finally(() => {
            setIsArchiving(false);
            setArchiveOpen(false);
          });
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
