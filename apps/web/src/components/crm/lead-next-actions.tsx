"use client";

import { AlarmClock, Archive, CalendarClock, ShoppingCart, UserCheck } from "lucide-react";
import { HeaderActions, type ActionSpec } from "@/components/shared/header-actions";
import type { WorkflowActionItem } from "@/components/business/workflow-actions-panel";
import { useLocale } from "@/providers/locale-provider";
import type { LeadRow } from "@/services/leads-service";

export interface LeadNextActionsProps {
  lead: LeadRow;
  canEdit: boolean;
  canConvert: boolean;
  canAssign: boolean;
  onFollowUp: () => void;
  onConvert: () => void;
  onAssign: () => void;
  onClose: () => void;
}

export function isLeadOperational(lead: Pick<LeadRow, "status">): boolean {
  return (
    lead.status?.code !== "CONVERTED" &&
    lead.status?.code !== "LOST" &&
    lead.status?.code !== "DISQUALIFIED"
  );
}

export function isLeadFollowUpOverdue(lead: Pick<LeadRow, "nextFollowUpAt">, now: number) {
  return Boolean(lead.nextFollowUpAt && new Date(lead.nextFollowUpAt).getTime() < now);
}

/**
 * The lead's header actions by workflow priority (design-system §12.6):
 * convert when qualified → assign when unassigned → (overdue) follow-up.
 * Pure, so the classic header and the Round 3 pilot header share one rule.
 */
export function planLeadNextActions(
  {
    lead,
    canEdit,
    canConvert,
    canAssign,
    onFollowUp,
    onConvert,
    onAssign,
    onClose,
  }: LeadNextActionsProps,
  t: ReturnType<typeof useLocale>["t"],
  now: number,
): { primary?: ActionSpec; secondary: ActionSpec[]; more: ActionSpec[] } {
  const overdue = isLeadFollowUpOverdue(lead, now);
  const qualified = lead.status?.code === "QUALIFIED";
  const unassigned = !lead.salesEmployeeId;

  const primary: ActionSpec | undefined =
    qualified && canConvert
      ? {
          key: "convert",
          label: t("crm.leads.convert.cta"),
          icon: ShoppingCart,
          onSelect: onConvert,
          variant: "success",
        }
      : unassigned && canAssign
        ? {
            key: "assign",
            label: t("crm.leads.actions.assign"),
            icon: UserCheck,
            onSelect: onAssign,
            variant: "default",
          }
        : canEdit
          ? {
              key: "followUp",
              label: overdue ? t("crm.leads.followUp.overdue") : t("crm.leads.actions.addFollowUp"),
              icon: CalendarClock,
              onSelect: onFollowUp,
              variant: overdue ? "warning" : "default",
            }
          : undefined;

  return {
    primary,
    secondary: [
      {
        key: "convert",
        label: t("crm.leads.convert.cta"),
        icon: ShoppingCart,
        hidden: !canConvert || primary?.key === "convert",
        onSelect: onConvert,
      },
    ],
    more: [
      {
        key: "followUp",
        label: t("crm.leads.actions.addFollowUp"),
        icon: CalendarClock,
        hidden: !canEdit || primary?.key === "followUp",
        onSelect: onFollowUp,
      },
      {
        key: "assign",
        label: lead.salesEmployee ? t("crm.leads.actions.transfer") : t("crm.leads.actions.assign"),
        icon: UserCheck,
        hidden: !canAssign,
        onSelect: onAssign,
      },
      {
        key: "close",
        label: t("crm.leads.actions.closeWithoutPurchase"),
        icon: Archive,
        hidden: !canEdit,
        onSelect: onClose,
      },
    ],
  };
}

/** The fields of an offered workflow transition the pilot plan reads. */
export interface LeadTransitionLike {
  toStatusCode: string;
  requiresReason?: boolean;
  businessAction?: string;
}

/**
 * The seeded NEW → IN_PROGRESS transition («بدء المتابعة / Start follow-up»)
 * only starts working the lead — the same intent as «إضافة متابعة». Round 3.1
 * pilot folds it into Add Follow-up: hidden from the header, run right after
 * a follow-up is saved on a NEW lead (the follow-up API itself never changes
 * the status). Plain transitions only — never one that needs a reason or
 * carries a business action.
 */
export function isLeadStartFollowUp(
  statusCode: string | null | undefined,
  transition: LeadTransitionLike,
): boolean {
  return (
    statusCode === "NEW" &&
    transition.toStatusCode === "IN_PROGRESS" &&
    !transition.requiresReason &&
    (transition.businessAction ?? "NONE") === "NONE"
  );
}

export interface LeadPilotActionPlan {
  /** «إضافة متابعة» — first in reading order. */
  followUp?: ActionSpec;
  /** «تحويل إلى طلب» — the green positive action, second. */
  convert?: ActionSpec;
  /** «المزيد» — assign/transfer and the other workflow transitions. */
  more: ActionSpec[];
  /** Close without purchase: red, separated, last in «المزيد». */
  destructive: ActionSpec[];
  /** The transition running right now (shown inline as a loading button). */
  running?: WorkflowActionItem;
}

/**
 * Round 3.1 pilot action group, read in logical order (mirrors in RTL):
 * Add Follow-up → Convert to Order → More. Same permissions as the classic
 * plan. Assign / Transfer lives in More (first while the lead is unassigned —
 * the detail card also offers Assign next to «غير مسند»). Other transitions
 * (e.g. «تأهيل») sit in More; the Start follow-up transition is folded into
 * Add Follow-up when the user may add one, and stays in More otherwise.
 */
export function planLeadPilotActions(
  {
    lead,
    canEdit,
    canConvert,
    canAssign,
    onFollowUp,
    onConvert,
    onAssign,
    onClose,
    followUpBusy = false,
  }: LeadNextActionsProps & { followUpBusy?: boolean },
  transitions: (WorkflowActionItem & LeadTransitionLike)[],
  t: ReturnType<typeof useLocale>["t"],
  now: number,
): LeadPilotActionPlan {
  const overdue = isLeadFollowUpOverdue(lead, now);
  const unassigned = !lead.salesEmployeeId;
  const busy = transitions.some((item) => item.loading);
  const running = transitions.find((item) => item.loading);

  const followUp: ActionSpec | undefined = canEdit
    ? {
        key: "followUp",
        label: t("crm.leads.actions.addFollowUp"),
        icon: overdue ? AlarmClock : CalendarClock,
        onSelect: onFollowUp,
        loading: followUpBusy,
        disabled: busy,
        testId: "lead-action-follow-up",
        // Overdue follow-up is the workflow priority: amber. Otherwise it is
        // the neutral companion of the green Convert (or the one primary).
        variant: overdue ? "warning" : canConvert ? "outline" : "default",
      }
    : undefined;

  const convert: ActionSpec | undefined = canConvert
    ? {
        key: "convert",
        label: t("crm.leads.convert.cta"),
        icon: ShoppingCart,
        onSelect: onConvert,
        disabled: busy || followUpBusy,
        testId: "lead-action-convert",
        variant: "success",
      }
    : undefined;

  const assign: ActionSpec = {
    key: "assign",
    label: lead.salesEmployee ? t("crm.leads.actions.transfer") : t("crm.leads.actions.assign"),
    icon: UserCheck,
    hidden: !canAssign,
    onSelect: onAssign,
  };
  const transitionSpecs: ActionSpec[] = transitions
    .filter((item) => !(canEdit && isLeadStartFollowUp(lead.status?.code, item)))
    .map((item) => ({
      key: `transition-${item.key}`,
      label: item.label,
      disabled: item.disabled,
      onSelect: item.onSelect,
    }));

  return {
    followUp,
    convert,
    more: unassigned ? [assign, ...transitionSpecs] : [...transitionSpecs, assign],
    destructive: [
      {
        key: "close",
        label: t("crm.leads.actions.closeWithoutPurchase"),
        icon: Archive,
        hidden: !canEdit,
        disabled: busy,
        onSelect: onClose,
      },
    ],
    running,
  };
}

export function LeadNextActions(props: LeadNextActionsProps) {
  const { t } = useLocale();
  if (!isLeadOperational(props.lead)) return null;

  // Follow-up urgency is evaluated at render time against the current clock.
  // eslint-disable-next-line react-hooks/purity -- overdue state is time-based
  const now = Date.now();
  const plan = planLeadNextActions(props, t, now);

  return <HeaderActions primary={plan.primary} secondary={plan.secondary} more={plan.more} />;
}
