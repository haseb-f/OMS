"use client";

import { CalendarClock, MoreHorizontal, ShoppingCart, UserCheck } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  const overdue = Boolean(
    lead.nextFollowUpAt && new Date(lead.nextFollowUpAt).getTime() < Date.now(),
  );
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
    <div className="flex flex-wrap items-center gap-1.5">
      {primary ? (
        <EnterpriseButton size="sm" variant={primary.variant} onClick={primary.run}>
          <primary.icon />
          {primary.label}
        </EnterpriseButton>
      ) : null}
      {canConvert && primary?.key !== "convert" ? (
        <EnterpriseButton size="sm" variant="outline" onClick={onConvert}>
          <ShoppingCart />
          {t("crm.leads.convert.cta")}
        </EnterpriseButton>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <EnterpriseButton size="sm" variant="outline">
            <MoreHorizontal />
            {t("common.moreActions")}
          </EnterpriseButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && primary?.key !== "followUp" ? (
            <DropdownMenuItem onSelect={onFollowUp}>
              {t("crm.leads.actions.addFollowUp")}
            </DropdownMenuItem>
          ) : null}
          {canAssign ? (
            <DropdownMenuItem onSelect={onAssign}>
              {lead.salesEmployee ? t("crm.leads.actions.transfer") : t("crm.leads.actions.assign")}
            </DropdownMenuItem>
          ) : null}
          {canEdit ? (
            <DropdownMenuItem onSelect={onClose}>
              {t("crm.leads.actions.closeWithoutPurchase")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
