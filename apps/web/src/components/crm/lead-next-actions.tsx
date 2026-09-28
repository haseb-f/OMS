"use client";

import { Archive, CalendarClock, ShoppingCart, UserCheck } from "lucide-react";
import { HeaderActions, type ActionSpec } from "@/components/shared/header-actions";
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

export function LeadNextActions(props: LeadNextActionsProps) {
  const { t } = useLocale();
  if (!isLeadOperational(props.lead)) return null;

  // Follow-up urgency is evaluated at render time against the current clock.
  // eslint-disable-next-line react-hooks/purity -- overdue state is time-based
  const now = Date.now();
  const plan = planLeadNextActions(props, t, now);

  return <HeaderActions primary={plan.primary} secondary={plan.secondary} more={plan.more} />;
}
