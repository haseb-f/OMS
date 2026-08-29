"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { DynamicStatusBadge } from "@/components/business/dynamic-status-badge";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import {
  workflowService,
  type WorkflowAction,
  type LeadConvertPayload,
} from "@/services/workflow-service";

export function WorkflowActionsPanel({
  entityType,
  entityId,
  currentStatus,
  onTransitionComplete,
  convertDefaults,
}: {
  entityType: string;
  entityId: string;
  currentStatus?: { name: string; color: string } | null;
  onTransitionComplete: () => void;
  convertDefaults?: Partial<LeadConvertPayload>;
}) {
  const { t, locale } = useLocale();
  const [actions, setActions] = useState<WorkflowAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [dialogAction, setDialogAction] = useState<WorkflowAction | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setActions(await workflowService.availableActions(entityType, entityId));
    } catch {
      setActions([]);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runTransition = async (action: WorkflowAction, transitionReason?: string) => {
    setPending(true);
    try {
      await workflowService.transition(entityType, entityId, {
        transitionId: action.transitionId,
        reason: transitionReason,
        ...(action.businessAction === "LEAD_CONVERT" && convertDefaults?.productId
          ? {
              productId: convertDefaults.productId,
              quantity: convertDefaults.quantity,
              unitPrice: convertDefaults.unitPrice,
              paymentType: convertDefaults.paymentType,
            }
          : {}),
      });
      toast.success(t("common.save"));
      setDialogAction(null);
      setReason("");
      await load();
      onTransitionComplete();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setPending(false);
    }
  };

  if (loading) return null;

  const primary = actions.find((a) => a.isPrimary) ?? actions[0];
  const secondary = actions.filter((a) => a !== primary);

  return (
    <div className="flex flex-col gap-3">
      {currentStatus ? (
        <DynamicStatusBadge label={currentStatus.name} colorKey={currentStatus.color} />
      ) : null}
      {actions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {primary ? (
            <EnterpriseButton
              size="sm"
              disabled={pending}
              onClick={() =>
                primary.requiresReason ? setDialogAction(primary) : void runTransition(primary)
              }
            >
              {locale === "ar" ? primary.label : (primary.labelEn ?? primary.label)}
            </EnterpriseButton>
          ) : null}
          {secondary.map((action) => (
            <EnterpriseButton
              key={action.transitionId}
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                action.requiresReason ? setDialogAction(action) : void runTransition(action)
              }
            >
              {locale === "ar" ? action.label : (action.labelEn ?? action.label)}
            </EnterpriseButton>
          ))}
        </div>
      ) : null}

      <EnterpriseModal
        open={dialogAction !== null}
        onOpenChange={(open) => !open && setDialogAction(null)}
        title={dialogAction?.label ?? ""}
        description={t("workflow.transition.reasonPrompt")}
        footer={(requestClose) => (
          <>
            <EnterpriseButton variant="outline" onClick={requestClose}>
              {t("common.cancel")}
            </EnterpriseButton>
            <EnterpriseButton
              disabled={pending || !reason.trim()}
              onClick={() => dialogAction && void runTransition(dialogAction, reason.trim())}
            >
              {t("common.confirm")}
            </EnterpriseButton>
          </>
        )}
      >
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("workflow.transition.reasonPlaceholder")}
          rows={3}
        />
      </EnterpriseModal>
    </div>
  );
}
