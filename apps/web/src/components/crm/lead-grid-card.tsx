"use client";

import {
  AlarmClock,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  MessageCircleMore,
  Phone,
  ShoppingCart,
  UserPlus,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/business/status-badge";
import { LeadStatusBadge } from "@/components/agent-portal/portal-badges";
import { FollowUpOutcomeBadge } from "@/components/crm/follow-up-outcome-badge";
import { LeadNewToYouMarker } from "@/components/crm/lead-new-to-you";
import { leadStatusBadge } from "@/components/crm/lead-status-label";
import { RecordGridCard, type RowAction } from "@/components/shared/data-table";
import { LocaleText } from "@/components/shared/locale-text";
import { SemanticValue } from "@/components/shared/semantic-value";
import {
  LEAD_WORKFLOW_STATE_TONE,
  isNewToViewer,
  leadNextAction,
  leadWorkflowState,
  type LeadNextActionInput,
  type LeadNextActionKind,
  type LeadWorkflowState,
} from "@/config/crm/lead-grid-state";
import { formatDisplayDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import type { LeadRow } from "@/services/leads-service";
import type { PortalLead } from "@/services/agent-portal-service";

/** Each state also carries an icon, so the workflow reads without the colour. */
const STATE_ICON: Record<LeadWorkflowState, LucideIcon> = {
  notContacted: CircleDashed,
  followingUp: MessageCircleMore,
  converted: CheckCircle2,
  closed: XCircle,
};

const NEXT_ICON: Record<LeadNextActionKind, LucideIcon> = {
  ASSIGN: UserPlus,
  CONVERT: ShoppingCart,
  FOLLOW_UP_OVERDUE: AlarmClock,
  FOLLOW_UP_SCHEDULED: CalendarClock,
  FIRST_CONTACT: Phone,
  SCHEDULE_FOLLOW_UP: CalendarClock,
};

interface LeadCardCommon {
  selected: boolean;
  onToggleSelected: () => void;
  href: string;
  actions?: RowAction[];
}

function LeadGridCardView({
  lead,
  statusBadge,
  customerName,
  mobileNumber,
  leadNumber,
  createdAt,
  canAssign,
  canConvert,
  meta,
  selected,
  onToggleSelected,
  href,
  actions,
}: LeadCardCommon & {
  lead: LeadNextActionInput & { viewedByMe?: boolean };
  statusBadge: ReactNode;
  customerName: string;
  mobileNumber: string;
  leadNumber: string;
  createdAt: string;
  canAssign?: boolean;
  canConvert?: boolean;
  meta?: ReactNode;
}) {
  const { t } = useLocale();
  const state = leadWorkflowState(lead);
  const next = leadNextAction(lead, { canAssign, canConvert });
  let nextLabel: string | null = null;
  if (next) {
    if (next.kind === "FOLLOW_UP_SCHEDULED") {
      nextLabel =
        next.day === "today"
          ? t("tableViews.leadNext.FOLLOW_UP_TODAY")
          : next.day === "tomorrow"
            ? t("tableViews.leadNext.FOLLOW_UP_TOMORROW")
            : t("tableViews.leadNext.FOLLOW_UP_LATER", {
                date: formatDisplayDate(next.scheduledAt ?? ""),
              });
    } else {
      nextLabel = t(`tableViews.leadNext.${next.kind}` as MessageKey);
    }
  }

  return (
    <RecordGridCard
      tone={LEAD_WORKFLOW_STATE_TONE[state]}
      selected={selected}
      onToggleSelected={onToggleSelected}
      selectLabel={t("tableViews.card.selectRow", { name: customerName })}
      title={<LocaleText>{customerName}</LocaleText>}
      subtitle={mobileNumber ? <SemanticValue kind="phone">{mobileNumber}</SemanticValue> : null}
      reference={
        <SemanticValue kind="id" className="font-medium">
          {leadNumber}
        </SemanticValue>
      }
      meta={meta ?? <SemanticValue kind="date">{formatDisplayDate(createdAt)}</SemanticValue>}
      marker={isNewToViewer(lead) ? <LeadNewToYouMarker /> : null}
      href={href}
      badges={
        <>
          {statusBadge}
          {lead.followUpOutcome ? <FollowUpOutcomeBadge value={lead.followUpOutcome} /> : null}
        </>
      }
      nextAction={
        next && nextLabel
          ? { label: nextLabel, icon: NEXT_ICON[next.kind], urgent: next.urgent }
          : null
      }
      nextActionLabel={t("tableViews.card.nextAction")}
      actions={actions}
      actionsLabel={t("tableViews.card.actions")}
    />
  );
}

/**
 * The company lead card of the Grid view. Colour = workflow state (not
 * contacted / following up / converted / closed); the status badge keeps the
 * state in words; the "new to you" marker is a separate, per-employee axis.
 */
export function LeadGridCard({
  lead,
  canAssign,
  ...common
}: LeadCardCommon & { lead: LeadRow; canAssign: boolean }) {
  const locale = useLocale();
  const badge = leadStatusBadge(lead, locale);
  return (
    <LeadGridCardView
      {...common}
      lead={lead}
      canAssign={canAssign}
      statusBadge={
        <StatusBadge
          label={badge.label}
          colorKey={badge.colorKey}
          icon={STATE_ICON[leadWorkflowState(lead)]}
        />
      }
      customerName={lead.customerName}
      mobileNumber={lead.mobileNumber}
      leadNumber={lead.leadNumber}
      createdAt={lead.createdAt}
      meta={
        lead.salesEmployee ? (
          <span className="max-w-32 truncate" title={lead.salesEmployee.fullName}>
            {lead.salesEmployee.fullName}
          </span>
        ) : undefined
      }
    />
  );
}

/** The agent-portal lead card: same card, the agent's own read-only fields. */
export function PortalLeadGridCard({
  lead,
  canConvert,
  ...common
}: LeadCardCommon & { lead: PortalLead; canConvert: boolean }) {
  return (
    <LeadGridCardView
      {...common}
      lead={lead}
      canConvert={canConvert}
      statusBadge={
        <LeadStatusBadge status={lead.status} icon={STATE_ICON[leadWorkflowState(lead)]} />
      }
      customerName={lead.customerName}
      mobileNumber={lead.mobileNumber}
      leadNumber={lead.leadNumber}
      createdAt={lead.createdAt}
    />
  );
}
