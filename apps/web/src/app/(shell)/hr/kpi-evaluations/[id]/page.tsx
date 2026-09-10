"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, FileText, RotateCcw, Send } from "lucide-react";
import {
  DetailField,
  DetailFieldGrid,
  DetailSection,
  DetailWorkspace,
} from "@/components/shared/detail-workspace";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { RowActionsMenu } from "@/components/shared/data-table";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/business/status-badge";
import { SemanticValue } from "@/components/shared/semantic-value";
import { KpiEvaluationItemCard } from "@/components/hr/kpi-evaluation-item-card";
import {
  kpiEvaluationsService,
  type KpiEvaluationRow,
  type ScoreKpiItemPayload,
} from "@/services/kpi-evaluations-service";
import { kpiTemplatesService, type KpiDropdownOption } from "@/services/kpi-templates-service";
import { kpiEvaluationStatusTone } from "@/config/hr/kpi-evaluations";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import type { MessageKey } from "@/i18n/translate";

function formatMoney(value: string | null) {
  if (value === null) return "—";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function KpiEvaluationDetailPage() {
  const params = useParams<{ id: string }>();
  const { t } = useLocale();
  const { hasPermission } = useUserContext();

  const canEdit = hasPermission("hr.kpi-evaluations.edit");
  const canSubmit = hasPermission("hr.kpi-evaluations.submit");
  const canApprove = hasPermission("hr.kpi-evaluations.approve");
  const canReopen = hasPermission("hr.kpi-evaluations.reopen");

  const [evaluation, setEvaluation] = useState<KpiEvaluationRow | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [dropdownOptionsByItemId, setDropdownOptionsByItemId] = useState<
    Record<string, KpiDropdownOption[]>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [isRecomputing, setIsRecomputing] = useState(false);

  const [submitOpen, setSubmitOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [isMutating, setIsMutating] = useState(false);

  useBreadcrumbLabel(
    evaluation ? `${evaluation.employeeProfile.partner.name} — ${evaluation.period}` : null,
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await kpiEvaluationsService.get(params.id);
      setEvaluation(data);
      const template = await kpiTemplatesService.get(data.kpiTemplateId);
      setTemplateName(template.name);
      setDropdownOptionsByItemId(
        Object.fromEntries(
          (template.items ?? []).map((item) => [item.id, item.dropdownOptions ?? []]),
        ),
      );
    } catch {
      setEvaluation(null);
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    // Fetch-on-dependency-change: the standard data-fetching effect pattern
    // (same as `MasterDataPage`) — setState happens inside `load`'s async
    // body, not synchronously in the effect itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (isLoading) {
    return <p className="text-caption text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!evaluation) {
    return <EmptyState icon={FileText} title={t("common.noResults")} />;
  }

  const isScorable = evaluation.status === "DRAFT" || evaluation.status === "MANAGER_SUBMITTED";
  const scoringDisabled = !isScorable || !canEdit;

  const saveItem = async (itemId: string, payload: ScoreKpiItemPayload) => {
    setSavingItemId(itemId);
    try {
      const updated = await kpiEvaluationsService.scoreItem(evaluation.id, itemId, payload);
      setEvaluation(updated);
      toast.success(t("hr.kpiEvaluations.toasts.saved"));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setSavingItemId(null);
    }
  };

  const recompute = async () => {
    setIsRecomputing(true);
    try {
      const updated = await kpiEvaluationsService.recomputeAutoMetrics(evaluation.id);
      setEvaluation(updated);
      toast.success(t("hr.kpiEvaluations.toasts.saved"));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsRecomputing(false);
    }
  };

  const confirmSubmit = async () => {
    setIsMutating(true);
    try {
      const updated = await kpiEvaluationsService.submit(evaluation.id);
      setEvaluation(updated);
      toast.success(t("hr.kpiEvaluations.toasts.submitted"));
      setSubmitOpen(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsMutating(false);
    }
  };

  const confirmApprove = async () => {
    setIsMutating(true);
    try {
      const updated = await kpiEvaluationsService.approve(evaluation.id);
      setEvaluation(updated);
      toast.success(t("hr.kpiEvaluations.toasts.approved"));
      setApproveOpen(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsMutating(false);
    }
  };

  const confirmReopen = async () => {
    if (!reopenReason.trim()) return;
    setIsMutating(true);
    try {
      const updated = await kpiEvaluationsService.reopen(evaluation.id, reopenReason.trim());
      setEvaluation(updated);
      toast.success(t("hr.kpiEvaluations.toasts.reopened"));
      setReopenOpen(false);
      setReopenReason("");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <DetailWorkspace
      title={evaluation.employeeProfile.partner.name}
      subtitle={`${evaluation.employeeProfile.employeeCode} — ${evaluation.period}`}
      status={
        <StatusBadge
          label={t(`hr.kpiEvaluations.status.${evaluation.status}` as MessageKey)}
          tone={kpiEvaluationStatusTone[evaluation.status]}
        />
      }
      actions={
        <RowActionsMenu
          label={t("common.actions")}
          actions={[
            {
              key: "submit",
              label: t("hr.kpiEvaluations.actions.submit"),
              icon: Send,
              hidden: !canSubmit || evaluation.status !== "DRAFT",
              onSelect: () => setSubmitOpen(true),
            },
            {
              key: "approve",
              label: t("hr.kpiEvaluations.actions.approve"),
              icon: CheckCircle2,
              hidden: !canApprove || evaluation.status !== "MANAGER_SUBMITTED",
              onSelect: () => setApproveOpen(true),
            },
            {
              key: "reopen",
              label: t("hr.kpiEvaluations.actions.reopen"),
              icon: RotateCcw,
              hidden: !canReopen || evaluation.status !== "HR_APPROVED",
              destructive: true,
              separatorBefore: true,
              onSelect: () => setReopenOpen(true),
            },
          ]}
        />
      }
    >
      <DetailSection title={t("common.generalInformation")}>
        <DetailFieldGrid>
          <DetailField label={t("hr.kpiEvaluations.fields.template")} value={templateName} />
          <DetailField
            label={t("hr.kpiEvaluations.fields.finalScore")}
            value={
              evaluation.finalScore === null ? undefined : `${formatMoney(evaluation.finalScore)}%`
            }
          />
          <DetailField
            label={t("hr.kpiEvaluations.fields.kpiPay")}
            value={
              evaluation.kpiPay === null ? undefined : (
                <SemanticValue kind="money">{formatMoney(evaluation.kpiPay)}</SemanticValue>
              )
            }
          />
          {evaluation.reopenReason && (
            <DetailField
              label={t("hr.kpiEvaluations.actions.reopenReason")}
              value={evaluation.reopenReason}
            />
          )}
        </DetailFieldGrid>
      </DetailSection>

      <DetailSection title={t("hr.kpiEvaluations.scoring.title")}>
        <div className="flex flex-col gap-3">
          {evaluation.items.map((item) => (
            <KpiEvaluationItemCard
              // Remounts (resetting the card's local draft state) whenever
              // the server row actually changes — after a save or a
              // recompute — instead of an effect that re-syncs `useState`
              // from props on every render.
              key={`${item.id}-${item.evaluatedAt ?? "unscored"}`}
              item={item}
              dropdownOptions={dropdownOptionsByItemId[item.kpiTemplateItemId] ?? []}
              disabled={scoringDisabled}
              isSaving={savingItemId === item.id}
              onSave={(payload) => void saveItem(item.id, payload)}
              onRecompute={() => void recompute()}
              isRecomputing={isRecomputing}
            />
          ))}
        </div>
      </DetailSection>

      <ConfirmationDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        title={t("hr.kpiEvaluations.actions.submit")}
        confirmLabel={t("hr.kpiEvaluations.actions.submit")}
        cancelLabel={t("common.cancel")}
        isConfirming={isMutating}
        onConfirm={() => void confirmSubmit()}
      />
      <ConfirmationDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title={t("hr.kpiEvaluations.actions.approve")}
        confirmLabel={t("hr.kpiEvaluations.actions.approve")}
        cancelLabel={t("common.cancel")}
        isConfirming={isMutating}
        onConfirm={() => void confirmApprove()}
      />
      <ConfirmationDialog
        open={reopenOpen}
        onOpenChange={(open) => {
          setReopenOpen(open);
          if (!open) setReopenReason("");
        }}
        tone="warning"
        title={t("hr.kpiEvaluations.actions.reopen")}
        confirmLabel={t("hr.kpiEvaluations.actions.reopen")}
        cancelLabel={t("common.cancel")}
        isConfirming={isMutating}
        confirmDisabled={!reopenReason.trim()}
        onConfirm={() => void confirmReopen()}
        extra={
          <Textarea
            placeholder={t("hr.kpiEvaluations.actions.reopenReason")}
            value={reopenReason}
            onChange={(event) => setReopenReason(event.target.value)}
          />
        }
      />
    </DetailWorkspace>
  );
}
