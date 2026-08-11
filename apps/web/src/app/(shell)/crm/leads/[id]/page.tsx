"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { UserCheck } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/shared/page-header";
import { EnterpriseButton } from "@/components/ui/button";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { PartyCard } from "@/components/business/party-card";
import { EntityTabs } from "@/components/business/entity-tabs";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { AssignLeadDialog } from "@/components/business/assign-lead-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PermissionGate } from "@/components/shared/permission-gate";
import { FileText } from "lucide-react";
import {
  leadsService,
  type LeadRow,
  type LeadActivityRow,
  type LeadAssignmentRow,
  type LeadNoteRow,
  type LeadStatusValue,
} from "@/services/leads-service";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDate, formatDateTime } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

const STATUS_TONE: Record<LeadStatusValue, StatusTone> = {
  NEW: "info",
  UNDER_FOLLOW_UP: "warning",
  PAID: "success",
  ARCHIVED: "neutral",
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2 last:border-b-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value || "—"}</dd>
    </div>
  );
}

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
  const [isTransitioning, setIsTransitioning] = useState(false);

  const canEdit = hasPermission("crm.leads.edit");
  const canManage = hasPermission("crm.leads.manage");

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
    setIsTransitioning(true);
    try {
      await action();
      toast.success(t("common.save"));
      await load();
      reloadSidePanels();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setIsTransitioning(false);
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
    return <div className="p-8 text-caption text-muted-foreground">{t("common.loading")}</div>;
  }
  if (!lead) {
    return <EmptyState icon={FileText} title={t("common.noResults")} />;
  }

  const timelineEntries: TimelineEntry[] = (activities ?? []).map((entry) => ({
    id: entry.id,
    title: entry.description,
    timestamp: formatDateTime(entry.createdAt),
    status:
      entry.type === "ARCHIVED" ? "rejected" : entry.type === "LEAD_CREATED" ? "done" : "pending",
  }));

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/crm/leads">{t("crm.leads.title")}</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{lead.leadNumber}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={lead.leadNumber}
        subtitle={lead.customerName}
        actions={
          <>
            {canEdit && lead.status === "NEW" && (
              <EnterpriseButton
                type="button"
                variant="outline"
                size="sm"
                disabled={isTransitioning}
                onClick={() => runTransition(() => leadsService.startFollowUp(lead.id))}
              >
                {t("crm.leads.actions.startFollowUp")}
              </EnterpriseButton>
            )}
            {canEdit && lead.status !== "PAID" && lead.status !== "ARCHIVED" && (
              <EnterpriseButton
                type="button"
                variant="outline"
                size="sm"
                disabled={isTransitioning}
                onClick={() => runTransition(() => leadsService.markPaid(lead.id))}
              >
                {t("crm.leads.actions.markPaid")}
              </EnterpriseButton>
            )}
            {canEdit && lead.status !== "ARCHIVED" && (
              <EnterpriseButton
                type="button"
                variant="outline"
                size="sm"
                disabled={isTransitioning}
                onClick={() => runTransition(() => leadsService.archiveLead(lead.id))}
              >
                {t("crm.leads.actions.archive")}
              </EnterpriseButton>
            )}
            {canManage && (
              <EnterpriseButton
                type="button"
                size="sm"
                className="gap-1.5"
                onClick={() => setAssignOpen(true)}
              >
                <UserCheck className="size-3.5" />
                {t("crm.leads.actions.reassign")}
              </EnterpriseButton>
            )}
          </>
        }
      />

      <PartyCard
        name={lead.customerName}
        code={lead.mobileNumber}
        contact={
          lead.customer
            ? `${t("crm.leads.fields.customer")}: ${lead.customer.customerNumber} — ${lead.customer.name}`
            : t("crm.leads.noCustomerLinked")
        }
        status={t(`crm.leads.status.${lead.status}` as MessageKey)}
        statusTone={STATUS_TONE[lead.status]}
        className={lead.customer ? "cursor-pointer transition-colors hover:bg-muted/40" : undefined}
      />
      {lead.customer && (
        <EnterpriseButton
          type="button"
          variant="ghost"
          size="sm"
          className="-mt-4 w-fit"
          onClick={() => router.push(`/sales/customers/${lead.customer!.id}`)}
        >
          {t("sales.customers.viewProfile")}
        </EnterpriseButton>
      )}
      {lead.possibleDuplicate && (
        <StatusBadge tone="warning" label={t("crm.leads.possibleDuplicate")} />
      )}

      <EntityTabs
        tabs={[
          {
            value: "general",
            label: t("crm.leads.sections.general"),
            content: (
              <EnterpriseCard>
                <EnterpriseCardHeader>
                  <EnterpriseCardTitle>{t("crm.leads.sections.general")}</EnterpriseCardTitle>
                </EnterpriseCardHeader>
                <EnterpriseCardContent>
                  <dl className="flex flex-col">
                    <InfoRow label={t("crm.leads.fields.customerName")} value={lead.customerName} />
                    <InfoRow label={t("crm.leads.fields.mobileNumber")} value={lead.mobileNumber} />
                    <InfoRow
                      label={t("crm.leads.fields.country")}
                      value={lead.country?.name ?? ""}
                    />
                    <InfoRow label={t("crm.leads.fields.city")} value={lead.city ?? ""} />
                    <InfoRow label={t("crm.leads.fields.address")} value={lead.address ?? ""} />
                    <InfoRow
                      label={t("crm.leads.fields.product")}
                      value={lead.product?.displayName ?? lead.product?.name ?? ""}
                    />
                    <InfoRow label={t("crm.leads.fields.quantity")} value={String(lead.quantity)} />
                    <InfoRow
                      label={t("crm.leads.fields.currency")}
                      value={lead.currency ? `${lead.currency.code} — ${lead.currency.name}` : ""}
                    />
                    <InfoRow
                      label={t("crm.leads.fields.externalOrderId")}
                      value={lead.externalOrderId ?? ""}
                    />
                    <InfoRow
                      label={t("crm.leads.fields.source")}
                      value={t(`crm.leads.source.${lead.source}` as MessageKey)}
                    />
                    <InfoRow
                      label={t("crm.leads.fields.createdAt")}
                      value={formatDate(lead.createdAt)}
                    />
                  </dl>
                </EnterpriseCardContent>
              </EnterpriseCard>
            ),
          },
          {
            value: "assignment",
            label: t("crm.leads.sections.assignment"),
            content: (
              <EnterpriseCard>
                <EnterpriseCardHeader>
                  <EnterpriseCardTitle>{t("crm.leads.sections.assignment")}</EnterpriseCardTitle>
                </EnterpriseCardHeader>
                <EnterpriseCardContent className="flex flex-col gap-3">
                  <InfoRow
                    label={t("crm.leads.fields.assignedTo")}
                    value={
                      lead.salesEmployee
                        ? `${lead.salesEmployee.fullName} — ${lead.salesEmployee.email}`
                        : ""
                    }
                  />
                  {assignments === null ? (
                    <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
                  ) : assignments.length > 0 ? (
                    <div className="flex flex-col gap-2 pt-2">
                      {assignments.map((assignment) => (
                        <div
                          key={assignment.id}
                          className="flex items-center justify-between border-b border-border/60 pb-2 text-sm last:border-b-0"
                        >
                          <span className="text-muted-foreground">
                            {formatDateTime(assignment.assignedAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </EnterpriseCardContent>
              </EnterpriseCard>
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
              <EnterpriseCard>
                <EnterpriseCardContent className="flex flex-col gap-4">
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
                        <div key={note.id} className="rounded-lg border border-border/60 p-3">
                          <p className="whitespace-pre-wrap text-sm">{note.text}</p>
                          <p className="pt-1 text-caption text-muted-foreground">
                            {formatDateTime(note.createdAt)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </EnterpriseCardContent>
              </EnterpriseCard>
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
    </div>
  );
}

export default function LeadDetailPage() {
  return (
    <PermissionGate permission="crm.leads.view">
      <LeadDetailContent />
    </PermissionGate>
  );
}
