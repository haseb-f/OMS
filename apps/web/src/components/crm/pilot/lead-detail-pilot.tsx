"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import {
  DetailField,
  DetailFieldGrid,
  DetailSection,
  DetailWorkspace,
} from "@/components/shared/detail-workspace";
import { DismissibleAlert } from "@/components/shared/dismissible-alert";
import { HeaderActions, type ActionSpec } from "@/components/shared/header-actions";
import { SemanticValue } from "@/components/shared/semantic-value";
import { EnterpriseButton } from "@/components/ui/button";
import { EntityTabs } from "@/components/business/entity-tabs";
import { StatusBadge } from "@/components/business/status-badge";
import { ClassificationBadge } from "@/components/business/classification-badge";
import {
  WorkflowActionsPanel,
  type WorkflowActionItem,
} from "@/components/business/workflow-actions-panel";
import {
  isLeadFollowUpOverdue,
  isLeadOperational,
  planLeadNextActions,
  type LeadNextActionsProps,
} from "@/components/crm/lead-next-actions";
import { LeadStageIndicator } from "@/components/crm/pilot/lead-stage-indicator";
import { pilotLeadBadge, pilotLeadStatusName } from "@/components/crm/pilot/lead-status-label";
import { useLocale } from "@/providers/locale-provider";
import { formatDate, formatDateTime } from "@/lib/date";
import type { WorkflowAction } from "@/services/workflow-service";
import type { LeadRow } from "@/services/leads-service";
import type { MessageKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";

/** In-place result of the last action on this page (design-system §11.4). */
export interface LeadOutcome {
  key: number;
  message: string;
}

/**
 * Round 3 pilot layout for the lead detail page (design-system §12.6).
 * Presentational only: data, handlers, permissions and dialogs come from the
 * page, so the business behavior is exactly the classic page's.
 */
export function LeadDetailPilot({
  lead,
  actions,
  classificationControl,
  outcome,
  onDismissOutcome,
  onTransitionComplete,
  tabs,
  followUpCount,
  children,
}: {
  lead: LeadRow;
  /** Same props the classic `LeadNextActions` receives. */
  actions: Omit<LeadNextActionsProps, "lead">;
  /** The editable classification combobox, or null when it is read-only. */
  classificationControl: ReactNode;
  outcome: LeadOutcome | null;
  onDismissOutcome: () => void;
  onTransitionComplete: (action: WorkflowAction) => void;
  tabs: { followUps: ReactNode; timeline: ReactNode; assignment: ReactNode; notes: ReactNode };
  followUpCount: number;
  /** The page's dialogs. */
  children?: ReactNode;
}) {
  const locale = useLocale();
  const { t } = locale;
  const operational = isLeadOperational(lead);
  // eslint-disable-next-line react-hooks/purity -- overdue state is time-based
  const now = Date.now();
  const overdue = operational && isLeadFollowUpOverdue(lead, now);
  const statusBadge = pilotLeadBadge(lead, locale);
  const closed = lead.status?.code === "LOST" || lead.status?.code === "DISQUALIFIED";

  const renderHeaderActions = (transitions: WorkflowActionItem[]) => {
    const transitionSpecs: ActionSpec[] = transitions.map((item) => ({
      key: `transition-${item.key}`,
      label: item.label,
      disabled: item.disabled,
      onSelect: item.onSelect,
    }));
    if (!operational) {
      // Closed / converted: only the backend-offered transitions (e.g. Reopen).
      return <HeaderActions secondary={transitionSpecs} />;
    }
    const plan = planLeadNextActions({ lead, ...actions }, t, now);
    return (
      <HeaderActions
        primary={plan.primary}
        secondary={[...plan.secondary, ...transitionSpecs]}
        // Closing without purchase ends the lead: red, separated, last. Its own
        // dialog asks for the reason, so it needs no extra confirm step.
        more={plan.more.filter((action) => action.key !== "close")}
        destructive={plan.more.filter((action) => action.key === "close")}
      />
    );
  };

  return (
    <DetailWorkspace
      className="gap-3"
      title={lead.customerName}
      reference={lead.leadNumber}
      status={
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge label={statusBadge.label} colorKey={statusBadge.colorKey} />
          {lead.customerClassification ? (
            <ClassificationBadge
              label={lead.customerClassification.name}
              color={lead.customerClassification.color}
            />
          ) : null}
          {lead.possibleDuplicate ? (
            <StatusBadge label={t("crm.leads.possibleDuplicate")} colorKey="warning" />
          ) : null}
        </div>
      }
      actions={
        <WorkflowActionsPanel
          entityType="LEAD"
          entityId={lead.id}
          hideConvert
          hideTargetCodes={["FOLLOW_UP", "LOST", "DISQUALIFIED"]}
          onTransitionComplete={onTransitionComplete}
          renderActions={renderHeaderActions}
        />
      }
    >
      {outcome ? (
        <DismissibleAlert key={outcome.key} tone="success" live onDismiss={onDismissOutcome}>
          {outcome.message}
        </DismissibleAlert>
      ) : null}

      {lead.storeOrder ? (
        <DismissibleAlert
          tone="success"
          dismissible={false}
          action={
            <EnterpriseButton asChild size="sm" variant="outline">
              <Link href={`/store-orders/${lead.storeOrder.id}`}>
                <ExternalLink />
                {t("crm.leads.openOrder")}
              </Link>
            </EnterpriseButton>
          }
        >
          <span className="text-body">
            {t("crm.leads.convert.convertedTo")}{" "}
            <Link
              href={`/store-orders/${lead.storeOrder.id}`}
              className="font-semibold text-foreground underline-offset-4 hover:underline"
            >
              <SemanticValue kind="id">{lead.storeOrder.internalOrderId}</SemanticValue>
            </Link>
          </span>
        </DismissibleAlert>
      ) : null}

      <DetailSection>
        <div className="-mx-3 -mt-0.5 flex min-w-0 items-center gap-3 border-b border-border px-3 pb-2.5">
          <span className="shrink-0 text-caption text-muted-foreground">
            {t("crm.leads.stage.label")}
          </span>
          <LeadStageIndicator
            statusCode={lead.status?.code}
            closedLabel={closed ? pilotLeadStatusName(lead.status, locale) : undefined}
          />
        </div>
        <div className="pt-1">
          <DetailFieldGrid columns={4} className="grid-cols-2 gap-y-3">
            <DetailField
              label={t("crm.leads.fields.assignedTo")}
              value={
                lead.salesEmployee?.fullName ?? (
                  <span className="font-normal text-muted-foreground">
                    {t("crm.leads.unassigned")}
                  </span>
                )
              }
            />
            <DetailField
              label={t("crm.leads.fields.nextFollowUp")}
              value={
                lead.nextFollowUpAt ? (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <SemanticValue
                      kind="date"
                      className={cn(overdue && "text-destructive-soft-foreground")}
                    >
                      {formatDateTime(lead.nextFollowUpAt)}
                    </SemanticValue>
                    {overdue ? (
                      <StatusBadge tone="destructive" label={t("crm.leads.followUp.overdue")} />
                    ) : null}
                  </span>
                ) : (
                  <span className="font-normal text-muted-foreground">—</span>
                )
              }
            />
            <DetailField
              className="col-span-2 sm:col-span-1"
              label={t("crm.leads.fields.classification")}
              value={
                classificationControl ??
                (lead.customerClassification ? (
                  <ClassificationBadge
                    label={lead.customerClassification.name}
                    color={lead.customerClassification.color}
                  />
                ) : (
                  <span className="font-normal text-muted-foreground">—</span>
                ))
              }
            />
            <DetailField
              label={t("crm.leads.fields.mobileNumber")}
              value={
                lead.mobileNumber ? (
                  <SemanticValue kind="phone">{lead.mobileNumber}</SemanticValue>
                ) : undefined
              }
            />
            <DetailField label={t("crm.leads.fields.country")} value={lead.country?.name} />
            <DetailField label={t("crm.leads.fields.city")} value={lead.city} />
            <DetailField
              label={t("crm.leads.fields.source")}
              value={t(`crm.leads.source.${lead.source}` as MessageKey)}
            />
            <DetailField
              label={t("crm.leads.fields.createdAt")}
              value={<SemanticValue kind="date">{formatDate(lead.createdAt)}</SemanticValue>}
            />
            <DetailField
              className="col-span-2"
              label={t("crm.leads.fields.address")}
              value={lead.address}
            />
            {lead.noPurchaseReason ? (
              <DetailField
                label={t("crm.leads.fields.noPurchaseReason")}
                value={lead.noPurchaseReason.name}
              />
            ) : null}
          </DetailFieldGrid>
        </div>
      </DetailSection>

      <EntityTabs
        defaultValue="followUps"
        tabs={[
          {
            value: "followUps",
            label: t("crm.leads.sections.followUps"),
            badge:
              followUpCount > 0 ? (
                <span className="num text-caption text-muted-foreground">{followUpCount}</span>
              ) : undefined,
            content: tabs.followUps,
          },
          { value: "timeline", label: t("crm.leads.sections.timeline"), content: tabs.timeline },
          {
            value: "assignment",
            label: t("crm.leads.sections.assignment"),
            content: tabs.assignment,
          },
          { value: "notes", label: t("crm.leads.sections.notes"), content: tabs.notes },
        ]}
      />

      {children}
    </DetailWorkspace>
  );
}
