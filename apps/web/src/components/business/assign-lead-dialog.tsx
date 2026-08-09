"use client";

import { useEffect, useState } from "react";
import { UserCheck } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { leadsService } from "@/services/leads-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

/**
 * TASK-061 §6 — Manual/Bulk Assignment. One `leadIds` (single- or
 * multi-select) always resolves through the same server-side rules manual
 * single-assign and Auto Assignment both use (active + `crm.leads.edit`) —
 * this dialog only offers the picker, never re-implements the eligibility
 * check itself. Leaving `salesEmployeeId` unset balance-distributes.
 */
export function AssignLeadDialog({
  open,
  onOpenChange,
  leadIds,
  onAssigned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  onAssigned?: () => void;
}) {
  const { t } = useLocale();
  const [employees, setEmployees] = useState<{ id: string; fullName: string; email: string }[]>([]);
  const [selected, setSelected] = useState<string>("__balanced__");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected("__balanced__");
    leadsService
      .eligibleAssignees()
      .then(setEmployees)
      .catch(() => setEmployees([]));
  }, [open]);

  const confirm = async () => {
    setIsSubmitting(true);
    try {
      const salesEmployeeId = selected === "__balanced__" ? undefined : selected;
      if (leadIds.length === 1 && salesEmployeeId) {
        await leadsService.assign(leadIds[0], salesEmployeeId);
      } else {
        await leadsService.bulkAssign(leadIds, salesEmployeeId);
      }
      toast.success(t("crm.leads.assignDialog.success"));
      onAssigned?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to assign.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={UserCheck}
      title={t("crm.leads.assignDialog.title")}
      description={t("crm.leads.assignDialog.description")}
      footer={(requestClose) => (
        <>
          <EnterpriseButton
            type="button"
            variant="ghost"
            onClick={requestClose}
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            onClick={confirm}
            disabled={isSubmitting || employees.length === 0}
          >
            {t("crm.leads.assignDialog.confirm")}
          </EnterpriseButton>
        </>
      )}
    >
      {employees.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          {t("crm.leads.assignDialog.noEligibleEmployees")}
        </p>
      ) : (
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("crm.leads.assignDialog.selectEmployee")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__balanced__">{t("crm.leads.assignDialog.balanced")}</SelectItem>
            {employees.map((employee) => (
              <SelectItem key={employee.id} value={employee.id}>
                {employee.fullName} — {employee.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </EnterpriseModal>
  );
}
