"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, UserCheck } from "lucide-react";
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
import {
  WorkflowActionsPanel,
  type WorkflowActionItem,
} from "@/components/business/workflow-actions-panel";
import {
  isLeadFollowUpOverdue,
  isLeadOperational,
  planLeadActions,
  type LeadNextActionsProps,
} from "@/components/crm/lead-next-actions";
import { LeadStageIndicator } from "@/components/crm/lead-stage-indicator";
import { FollowUpOutcomeBadge } from "@/components/crm/follow-up-outcome-badge";
import { leadStatusBadge, leadStatusName } from "@/components/crm/lead-status-label";
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

/** One inline action of the lead group (shared Button, 32px / 40px touch). */
function GroupButton({ action }: { action: ActionSpec }) {
  const Icon = action.icon;
  return (
    <EnterpriseButton
      type="button"
      variant={action.variant ?? "outline"}
      disabled={action.disabled}
      isLoading={action.loading}
      data-testid={action.testId}
      onClick={() => void action.onSelect?.()}
    >
      {Icon && !action.loading ? <Icon /> : null}
      {action.label}
    </EnterpriseButton>
  );
}

/**
 * Lead detail page layout (design-system §12.6). Presentational only:
 * data, handlers, permissions and dialogs come from the page.
 */
export function LeadDetailView({
  lead,
  actions,
  followUpBusy = false,
  outcome,
  onDismissOutcome,
  onTransitionComplete,
  tabs,
  followUpCount,
  children,
}: {
  lead: LeadRow;
  /** Header action handlers and permissions (see `planLeadActions`). */
  actions: Omit<LeadNextActionsProps, "lead">;
  /** A saved follow-up is still finishing (folded Start follow-up running). */
  followUpBusy?: boolean;
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
  const statusBadge = leadStatusBadge(lead, locale);
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
    const plan = planLeadActions({ lead, ...actions, followUpBusy }, transitions, t, now);
    // Reading order (logical, mirrors in RTL): Add Follow-up → Convert to
    // Order → More. `HeaderActions` supplies the «المزيد» menu only, since its
    // own order puts the overflow first.
    return (
      <div
        data-lead-actions=""
        aria-busy={Boolean(plan.running) || followUpBusy || undefined}
        className="flex min-w-0 flex-wrap items-center justify-end gap-2"
      >
        {plan.followUp ? <GroupButton action={plan.followUp} /> : null}
        {plan.convert ? <GroupButton action={plan.convert} /> : null}
        {plan.running ? (
          <GroupButton action={{ key: "running", label: plan.running.label, loading: true }} />
        ) : null}
        <HeaderActions
          more={plan.more}
          // Closing without purchase ends the lead: red, separated, last. Its
          // own dialog asks for the reason, so it needs no extra confirm step.
          destructive={plan.destructive}
        />
      </div>
    );
  };

  return (
    <DetailWorkspace
      className="gap-3"
      title={lead.customerName}
      reference={lead.leadNumber}
      copyValue={lead.leadNumber}
      status={
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge label={statusBadge.label} colorKey={statusBadge.colorKey} />
          {lead.followUpOutcome ? <FollowUpOutcomeBadge value={lead.followUpOutcome} /> : null}
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
            leadId={lead.id}
            statusCode={lead.status?.code}
            closedLabel={closed ? leadStatusName(lead.status, locale) : undefined}
          />
        </div>
        <div className="pt-1">
          <DetailFieldGrid columns={4} className="grid-cols-2 gap-y-3">
            <DetailField
              label={t("crm.leads.fields.assignedTo")}
              value={
                lead.salesEmployee?.fullName ?? (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span className="font-normal text-muted-foreground">
                      {t("crm.leads.unassigned")}
                    </span>
                    {operational && actions.canAssign ? (
                      // Workflow priority stays visible where the gap is.
                      <EnterpriseButton
                        type="button"
                        variant="link"
                        size="inline"
                        onClick={actions.onAssign}
                      >
                        <UserCheck />
                        {t("crm.leads.actions.assign")}
                      </EnterpriseButton>
                    ) : null}
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
              label={t("leadOps.outcome.label")}
              value={
                lead.followUpOutcome ? (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <FollowUpOutcomeBadge value={lead.followUpOutcome} />
                    {lead.followUpOutcomeAt ? (
                      <SemanticValue kind="date" className="text-caption text-muted-foreground">
                        {formatDateTime(lead.followUpOutcomeAt)}
                      </SemanticValue>
                    ) : null}
                  </span>
                ) : (
                  <span className="font-normal text-muted-foreground">
                    {t("leadOps.outcome.none")}
                  </span>
                )
              }
            />
            <DetailField
              label={t("crm.leads.fields.mobileNumber")}
              value={
                lead.mobileNumber ? (
                  <SemanticValue kind="phone" copyable>
                    {lead.mobileNumber}
                  </SemanticValue>
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
