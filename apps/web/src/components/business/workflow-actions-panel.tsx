"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function WorkflowActionsPanel({
  entityType,
  entityId,
  currentStatus,
  onTransitionComplete,
  convertDefaults,
  hideConvert,
}: {
  entityType: string;
  entityId: string;
  currentStatus?: { name: string; color: string } | null;
  onTransitionComplete: () => void;
  convertDefaults?: Partial<LeadConvertPayload>;
  hideConvert?: boolean;
}) {
  const { t, locale } = useLocale();
  const [actions, setActions] = useState<WorkflowAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [dialogAction, setDialogAction] = useState<WorkflowAction | null>(null);
  const [reason, setReason] = useState("");
  const [convertAction, setConvertAction] = useState<WorkflowAction | null>(null);
  const [unitPrice, setUnitPrice] = useState(String(convertDefaults?.unitPrice ?? ""));
  const [quantity, setQuantity] = useState(String(convertDefaults?.quantity ?? 1));
  const [paymentType, setPaymentType] = useState(convertDefaults?.paymentType ?? "PREPAID");
  const [notes, setNotes] = useState(convertDefaults?.notes ?? "");

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const runTransition = async (
    action: WorkflowAction,
    transitionReason?: string,
    convert?: LeadConvertPayload,
  ) => {
    setPending(true);
    try {
      await workflowService.transition(entityType, entityId, {
        transitionId: action.transitionId,
        reason: transitionReason,
        ...(action.businessAction === "LEAD_CONVERT"
          ? {
              productId: convert?.productId ?? convertDefaults?.productId,
              quantity: convert?.quantity ?? convertDefaults?.quantity ?? 1,
              unitPrice:
                convert?.unitPrice ??
                convertDefaults?.unitPrice ??
                (unitPrice ? Number(unitPrice) : undefined),
              paymentType: convert?.paymentType ?? paymentType,
              notes: convert?.notes ?? notes,
            }
          : {}),
      });
      toast.success(t("common.save"));
      setDialogAction(null);
      setConvertAction(null);
      setReason("");
      await load();
      onTransitionComplete();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setPending(false);
    }
  };

  const handleAction = (action: WorkflowAction) => {
    if (action.businessAction === "LEAD_CONVERT") {
      setConvertAction(action);
      return;
    }
    if (action.requiresReason) {
      setDialogAction(action);
      return;
    }
    void runTransition(action);
  };

  if (loading) return null;

  const visibleActions = hideConvert
    ? actions.filter((action) => action.businessAction !== "LEAD_CONVERT")
    : actions;
  const convert = visibleActions.find((a) => a.businessAction === "LEAD_CONVERT");
  const primary = convert ?? visibleActions.find((a) => a.isPrimary) ?? visibleActions[0];
  const secondary = visibleActions.filter((a) => a !== primary);

  if (hideConvert && visibleActions.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {currentStatus ? (
        <DynamicStatusBadge label={currentStatus.name} colorKey={currentStatus.color} />
      ) : null}
      {visibleActions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {primary ? (
            <EnterpriseButton size="sm" disabled={pending} onClick={() => handleAction(primary)}>
              {locale === "ar" ? primary.label : (primary.labelEn ?? primary.label)}
            </EnterpriseButton>
          ) : null}
          {secondary.map((action) => (
            <EnterpriseButton
              key={action.transitionId}
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => handleAction(action)}
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

      <EnterpriseModal
        open={convertAction !== null}
        onOpenChange={(open) => !open && setConvertAction(null)}
        title={t("crm.leads.convert.title")}
        description={t("crm.leads.convert.description")}
        footer={(requestClose) => (
          <>
            <EnterpriseButton variant="outline" onClick={requestClose}>
              {t("common.cancel")}
            </EnterpriseButton>
            <EnterpriseButton
              disabled={pending}
              onClick={() =>
                convertAction &&
                void runTransition(convertAction, undefined, {
                  productId: convertDefaults?.productId,
                  quantity: Number(quantity) || 1,
                  unitPrice: unitPrice ? Number(unitPrice) : undefined,
                  paymentType,
                  notes,
                })
              }
            >
              {t("crm.leads.convert.cta")}
            </EnterpriseButton>
          </>
        )}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>{t("crm.leads.fields.quantity")}</Label>
            <Input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("crm.leads.convert.unitPrice")}</Label>
            <Input
              type="number"
              min={0}
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("crm.leads.convert.paymentType")}</Label>
            <Select
              value={paymentType}
              onValueChange={(v) => setPaymentType(v as "PREPAID" | "CASH_ON_DELIVERY")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PREPAID">{t("crm.leads.convert.prepaid")}</SelectItem>
                <SelectItem value="CASH_ON_DELIVERY">{t("crm.leads.convert.cod")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("crm.leads.followUp.note")}</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </EnterpriseModal>
    </div>
  );
}
