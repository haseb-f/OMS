"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { DetailField, DetailSection } from "@/components/shared/detail-workspace";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { EnterpriseButton } from "@/components/ui/button";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { AssignLeadDialog } from "@/components/business/assign-lead-dialog";
import { LeadFollowUpDialog } from "@/components/crm/lead-follow-up-dialog";
import { LeadConvertDialog } from "@/components/crm/lead-convert-dialog";
import { LeadCloseWithoutPurchaseDialog } from "@/components/crm/lead-close-dialog";
import { isLeadStartFollowUp } from "@/components/crm/lead-next-actions";
import { LeadDetailView, type LeadOutcome } from "@/components/crm/lead-detail-view";
import { leadStatusName } from "@/components/crm/lead-status-label";
import { EmptyState } from "@/components/shared/empty-state";
import { PermissionGate } from "@/components/shared/permission-gate";
import { Textarea } from "@/components/ui/textarea";
import {
  leadsService,
  type LeadRow,
  type LeadActivityRow,
  type LeadAssignmentRow,
  type LeadFollowUpRow,
  type LeadNoteRow,
} from "@/services/leads-service";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";
import { formatDateTime } from "@/lib/date";
import { SemanticValue } from "@/components/shared/semantic-value";
import type { MessageKey } from "@/i18n/translate";
import { followUpOutcomeLabel } from "@/config/crm/follow-up-outcomes";
import { workflowService, type WorkflowAction } from "@/services/workflow-service";

/** `LeadAssignmentMethod` values with a label (crm.leads.assignmentMethod.*). */
const ASSIGNMENT_METHODS: ReadonlySet<string> = new Set([
  "AUTO_CONTINUOUS",
  "AUTO_24H",
  "MANUAL",
  "REASSIGNMENT",
  "IMPORT",
  "SYSTEM",
]);

function LeadDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const locale = useLocale();
  const { t } = locale;
  const { hasPermission } = useUserContext();

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
  // The last action's result, shown in place (§11.4).
  const [outcome, setOutcome] = useState<LeadOutcome | null>(null);
  const announce = (message: string) => setOutcome({ key: Date.now(), message });
  // The folded Start follow-up transition is running.
  const [followUpBusy, setFollowUpBusy] = useState(false);

  const canEdit = hasPermission("crm.leads.edit");
  const canConvert = hasPermission("crm.leads.convert") || canEdit;

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
      reportApiError(error, "common.failedToSave");
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

  // Follow-up titles never show a lone «—» or a raw outcome
  // key; the dialog stores the outcome as a code (e.g. `noAnswer`).
  const followUpTitle = (item: LeadFollowUpRow) => {
    if (item.outcome) return followUpOutcomeLabel(item.outcome, t);
    const type = item.followUpType;
    if (type) return locale.locale === "ar" ? type.name : (type.nameEn ?? type.name);
    return t("crm.leads.followUp.noOutcome");
  };

  const followUpsContent = (
    <DetailSection>
      {(followUps ?? []).length === 0 ? (
        <p className="text-caption text-muted-foreground">{t("common.noResults")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {(followUps ?? []).map((item) => (
            <div key={item.id} className="border-t border-border pt-2 first:border-t-0 first:pt-0">
              <p
                className={
                  !item.outcome && !item.followUpType
                    ? "text-body text-muted-foreground"
                    : "text-body font-medium"
                }
              >
                {followUpTitle(item)}
              </p>
              {item.note ? <p className="text-caption">{item.note}</p> : null}
              <p className="text-caption text-muted-foreground">
                {item.user?.fullName} ·{" "}
                <SemanticValue kind="date">{formatDateTime(item.createdAt)}</SemanticValue>
                {item.followUpAt ? (
                  <>
                    {" "}
                    · {t("crm.leads.fields.nextFollowUp")}:{" "}
                    <SemanticValue kind="date">{formatDateTime(item.followUpAt)}</SemanticValue>
                  </>
                ) : null}
              </p>
            </div>
          ))}
        </div>
      )}
    </DetailSection>
  );

  const timelineContent =
    activities === null ? (
      <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
    ) : timelineEntries.length === 0 ? (
      <p className="text-caption text-muted-foreground">{t("common.noActivity")}</p>
    ) : (
      <AuditTimeline entries={timelineEntries} />
    );

  const assignmentContent = (
    <DetailSection>
      <DetailField
        label={t("crm.leads.fields.assignedTo")}
        value={
          lead.salesEmployee
            ? `${lead.salesEmployee.fullName} — ${lead.salesEmployee.email}`
            : undefined
        }
      />
      {/* Isolated LTR date, method in the UI language. */}
      {(assignments ?? []).map((assignment) => (
        <p key={assignment.id} className="text-caption text-muted-foreground">
          <SemanticValue kind="date">{formatDateTime(assignment.assignedAt)}</SemanticValue> ·{" "}
          {assignment.assignedTo?.fullName} ·{" "}
          {ASSIGNMENT_METHODS.has(assignment.method)
            ? t(`crm.leads.assignmentMethod.${assignment.method}` as MessageKey)
            : assignment.method}
        </p>
      ))}
    </DetailSection>
  );

  const notesContent = (
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
  );

  const transitionedMessage = (action: Pick<WorkflowAction, "toStatusCode" | "toStatusName">) =>
    t("crm.leads.transitioned", {
      status:
        leadStatusName(
          { code: action.toStatusCode, name: action.toStatusName } as LeadRow["status"],
          locale,
        ) ?? action.toStatusName,
    });

  /**
   * «بدء المتابعة» (NEW → IN_PROGRESS) is folded into Add Follow-up.
   * Recording a follow-up never changes the status server-side, so on a NEW
   * lead the page then runs that same workflow transition — only if
   * the engine offers it to this user — keeping its business effect.
   */
  const finishFollowUp = async () => {
    let message = t("crm.leads.followUp.saved");
    if (lead.status?.code === "NEW") {
      setFollowUpBusy(true);
      try {
        const offered = await workflowService.availableActions("LEAD", lead.id);
        const start = offered.find((action) => isLeadStartFollowUp(lead.status?.code, action));
        if (start) {
          await workflowService.transition("LEAD", lead.id, { transitionId: start.transitionId });
          message = `${message} ${transitionedMessage(start)}`;
        }
      } catch (error) {
        reportApiError(error, "common.failedToSave");
      } finally {
        setFollowUpBusy(false);
      }
    }
    announce(message);
    void load();
    reloadSidePanels();
  };

  const dialogs = (
    <>
      <LeadFollowUpDialog
        open={followUpOpen}
        onOpenChange={setFollowUpOpen}
        leadId={lead.id}
        onSaved={() => void finishFollowUp()}
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
          announce(t("crm.leads.closeWithoutPurchase.success"));
          void load();
          reloadSidePanels();
        }}
      />
      <AssignLeadDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        leadIds={[lead.id]}
        onAssigned={() => {
          announce(t("crm.leads.assignDialog.success"));
          void load();
          reloadSidePanels();
        }}
      />
    </>
  );

  return (
    <LeadDetailView
      lead={lead}
      actions={{
        canEdit,
        canConvert,
        canAssign,
        onFollowUp: () => setFollowUpOpen(true),
        onConvert: () => setConvertOpen(true),
        onAssign: () => setAssignOpen(true),
        onClose: () => setCloseOpen(true),
      }}
      followUpBusy={followUpBusy}
      outcome={outcome}
      onDismissOutcome={() => setOutcome(null)}
      onTransitionComplete={(action) => {
        announce(transitionedMessage(action));
        void load();
        reloadSidePanels();
      }}
      tabs={{
        followUps: followUpsContent,
        timeline: timelineContent,
        assignment: assignmentContent,
        notes: notesContent,
      }}
      followUpCount={followUps?.length ?? 0}
    >
      {dialogs}
    </LeadDetailView>
  );
}

export default function LeadDetailPage() {
  return (
    <PermissionGate permission="crm.leads.view">
      <LeadDetailContent />
    </PermissionGate>
  );
}
