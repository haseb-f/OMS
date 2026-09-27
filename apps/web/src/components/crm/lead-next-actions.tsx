"use client";

import { Archive, CalendarClock, ShoppingCart, UserCheck } from "lucide-react";
import { HeaderActions } from "@/components/shared/header-actions";
import { useLocale } from "@/providers/locale-provider";
import type { LeadRow } from "@/services/leads-service";

export function LeadNextActions({
  lead,
  canEdit,
  canConvert,
  canAssign,
  onFollowUp,
  onConvert,
  onAssign,
  onClose,
}: {
  lead: LeadRow;
  canEdit: boolean;
  canConvert: boolean;
  canAssign: boolean;
  onFollowUp: () => void;
  onConvert: () => void;
  onAssign: () => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const operational =
    lead.status?.code !== "CONVERTED" &&
    lead.status?.code !== "LOST" &&
    lead.status?.code !== "DISQUALIFIED";
  if (!operational) return null;

  // Follow-up urgency is evaluated at render time against the current clock.
  // eslint-disable-next-line react-hooks/purity -- overdue state is time-based
  const now = Date.now();
  const overdue = Boolean(lead.nextFollowUpAt && new Date(lead.nextFollowUpAt).getTime() < now);
  const qualified = lead.status?.code === "QUALIFIED";
  const unassigned = !lead.salesEmployeeId;

  const primary =
    qualified && canConvert
      ? {
          key: "convert" as const,
          label: t("crm.leads.convert.cta"),
          icon: ShoppingCart,
          run: onConvert,
          variant: "success" as const,
        }
      : unassigned && canAssign
        ? {
            key: "assign" as const,
            label: t("crm.leads.actions.assign"),
            icon: UserCheck,
            run: onAssign,
            variant: "default" as const,
          }
        : canEdit
          ? {
              key: "followUp" as const,
              label: overdue ? t("crm.leads.followUp.overdue") : t("crm.leads.actions.addFollowUp"),
              icon: CalendarClock,
              run: onFollowUp,
              variant: overdue ? ("warning" as const) : ("default" as const),
            }
          : null;

  return (
    <HeaderActions
      primary={
        primary
          ? {
              key: primary.key,
              label: primary.label,
              icon: primary.icon,
              variant: primary.variant,
              onSelect: primary.run,
            }
          : undefined
      }
      secondary={[
        {
          key: "convert",
          label: t("crm.leads.convert.cta"),
          icon: ShoppingCart,
          hidden: !canConvert || primary?.key === "convert",
          onSelect: onConvert,
        },
      ]}
      more={[
        {
          key: "followUp",
          label: t("crm.leads.actions.addFollowUp"),
          icon: CalendarClock,
          hidden: !canEdit || primary?.key === "followUp",
          onSelect: onFollowUp,
        },
        {
          key: "assign",
          label: lead.salesEmployee
            ? t("crm.leads.actions.transfer")
            : t("crm.leads.actions.assign"),
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
      ]}
    />
  );
}
