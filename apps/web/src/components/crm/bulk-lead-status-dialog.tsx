"use client";

import { useEffect, useState } from "react";
import { Workflow } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EnterpriseButton } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { workflowService, type WorkflowStatusOption } from "@/services/workflow-service";
import { leadsService } from "@/services/leads-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

/**
 * Bulk "Change Status" from the Leads list's Smart Selection — mirrors
 * `BulkShippingStatusDialog` exactly (same shape, one confirmation covers
 * the whole batch). A selection can span several current statuses, so this
 * always offers the full dynamic LEAD status catalog rather than "available
 * actions from a single Lead" — the server
 * (`LeadsService.bulkChangeStatus`, reusing `executeTransitionByCodes` per
 * Lead exactly as the single-Lead `WorkflowActionsPanel` does) decides, per
 * Lead, whether that transition is actually valid and reports partial
 * success instead of forcing an invalid state.
 */
export function BulkLeadStatusDialog({
  open,
  onOpenChange,
  selectedIds,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const [statuses, setStatuses] = useState<WorkflowStatusOption[]>([]);
  const [statusCode, setStatusCode] = useState("");
  const [reason, setReason] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatusCode("");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReason("");
    workflowService
      .statusesByWorkflow("LEAD")
      .then(setStatuses)
      .catch(() => setStatuses([]));
  }, [open]);

  const selectedStatus = statuses.find((status) => status.code === statusCode);
  const selectedCount = selectedIds.length;

  const handleOpenChange = (next: boolean) => {
    if (isSubmitting) return;
    onOpenChange(next);
  };

  const submit = async () => {
    if (!statusCode) return;
    setIsSubmitting(true);
    try {
      const result = await leadsService.bulkChangeStatus({
        leadIds: selectedIds,
        statusCode,
        reason: reason.trim() || undefined,
      });
      if (result.failed.length === 0) {
        toast.success(t("crm.leads.bulkStatus.successMessage", { count: result.succeeded.length }));
      } else if (result.succeeded.length === 0) {
        toast.error(t("crm.leads.bulkStatus.allFailedMessage", { count: result.failed.length }));
      } else {
        toast.success(
          t("crm.leads.bulkStatus.successMessage", { count: result.succeeded.length }),
          {
            description: t("crm.leads.bulkStatus.partialFailureMessage", {
              count: result.failed.length,
            }),
          },
        );
      }
      onOpenChange(false);
      onChanged();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Workflow className="size-4" />
              {t("crm.leads.bulkStatus.dialogTitle")}
            </DialogTitle>
          </DialogHeader>

          <p className="text-caption text-muted-foreground">
            {t("crm.leads.bulkStatus.selectedCount", { count: selectedCount })}
          </p>

          <div className="flex flex-col gap-1.5">
            <Label>{t("crm.leads.bulkStatus.newStatusLabel")}</Label>
            <Select value={statusCode || "__none__"} onValueChange={setStatusCode}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("crm.leads.bulkStatus.newStatusPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((status) => (
                  <SelectItem key={status.id} value={status.code}>
                    {status.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("crm.leads.bulkStatus.reasonLabel")}</Label>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder={t("crm.leads.bulkStatus.reasonPlaceholder")}
            />
          </div>

          <DialogFooter>
            <EnterpriseButton
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              {t("common.cancel")}
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              disabled={!statusCode}
              onClick={() => setPendingConfirm(true)}
            >
              {t("crm.leads.bulkStatus.submit")}
            </EnterpriseButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={pendingConfirm}
        onOpenChange={setPendingConfirm}
        title={t("crm.leads.bulkStatus.confirmTitle")}
        description={t("crm.leads.bulkStatus.confirmDescription", {
          count: selectedCount,
          status: selectedStatus?.name ?? "",
        })}
        confirmLabel={t("crm.leads.bulkStatus.confirmAction")}
        onConfirm={() => {
          if (!statusCode) return;
          setPendingConfirm(false);
          void submit();
        }}
      />
    </>
  );
}
