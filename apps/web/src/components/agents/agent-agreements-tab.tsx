"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { CheckCircle2, Eye, FileSignature, Pencil, Plus, StopCircle } from "lucide-react";
import { DetailSection } from "@/components/shared/detail-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { EnterpriseButton } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/business/status-badge";
import { RowActionsMenu } from "@/components/shared/data-table";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { tableIdentityCellClass } from "@/components/ui/table";
import {
  agentsService,
  type AgentAgreement,
  type AgentAgreementDetail,
  type AgreementPreview,
} from "@/services/agents-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate, formatDateTime, toISODate } from "@/lib/date";
import { ltrIsolate } from "@/lib/bidi";
import type { MessageKey } from "@/i18n/translate";
import { localizedApiMessage } from "@/config/orders/agent-order-entry";
import { apiErrorMessage, reportApiError, toast } from "@/lib/toast";
import { uiLanguagePart } from "@/services/api-client";
import { AgreementFormDialog } from "./agreement-form-dialog";
import { AgreementTerms } from "./agreement-terms";
import { AgreementPreviewPanel } from "./agreement-preview-panel";
import { formatClassRates } from "@/config/agents/agreement-form";

const STATUS_TONE = { DRAFT: "neutral", ACTIVE: "success", ENDED: "warning" } as const;

export function AgentAgreementsTab({
  agentId,
  currencyCode,
  onChanged,
}: {
  agentId: string;
  currencyCode: string;
  /** The agent header / overview show the active agreement — refresh them after a change. */
  onChanged: () => void;
}) {
  const { t, locale } = useLocale();
  const { hasPermission } = useUserContext();
  const canManage = hasPermission("agents.agreements.manage");
  const endFieldId = useId();
  const [agreements, setAgreements] = useState<AgentAgreement[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<AgentAgreement | "new" | null>(null);
  const [viewTarget, setViewTarget] = useState<AgentAgreement | null>(null);
  // R17 §2 — the viewed version's audit trail (who / when / field diff).
  const [viewDetail, setViewDetail] = useState<AgentAgreementDetail | null>(null);
  const [activateTarget, setActivateTarget] = useState<AgentAgreement | null>(null);
  // Activation waits for the preview; a product without a rate blocks it (A3/A4).
  const [previewBlocked, setPreviewBlocked] = useState(true);
  const onPreviewLoaded = useCallback(
    (preview: AgreementPreview) => setPreviewBlocked(preview.items.some((item) => item.missing)),
    [],
  );
  const [endTarget, setEndTarget] = useState<AgentAgreement | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setAgreements(await agentsService.agreements.list(agentId));
    } catch (error) {
      setLoadError(apiErrorMessage(error, "errors.loadFailed"));
    }
  }, [agentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (!viewTarget) return;
    let cancelled = false;
    agentsService.agreements
      .get(agentId, viewTarget.id)
      .then((detail) => !cancelled && setViewDetail(detail))
      .catch((error: unknown) => reportApiError(error, "errors.loadFailed"));
    return () => {
      cancelled = true;
    };
  }, [agentId, viewTarget]);

  const refresh = () => {
    void load();
    onChanged();
  };

  const activate = async () => {
    if (!activateTarget) return;
    setIsBusy(true);
    try {
      const { warnings } = await agentsService.agreements.activate(agentId, activateTarget.id);
      toast.success(t("agents.agreements.toasts.activated"));
      // R15 D15-13 — e.g. no shipping agreement covers its start date yet.
      for (const warning of warnings) {
        toast.warning(uiLanguagePart(warning.message, locale) ?? warning.code);
      }
      setActivateTarget(null);
      refresh();
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsBusy(false);
    }
  };

  const end = async () => {
    if (!endTarget) return;
    setIsBusy(true);
    try {
      await agentsService.agreements.end(
        agentId,
        endTarget.id,
        endDate ? toISODate(endDate) : undefined,
      );
      toast.success(t("agents.agreements.toasts.ended"));
      setEndTarget(null);
      refresh();
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsBusy(false);
    }
  };

  if (loadError) return <ErrorState description={loadError} onRetry={() => void load()} />;
  if (!agreements) return null;

  /** R17 §2 — the instants a version was in force, when it has them. */
  const versionWindow = (row: AgentAgreement) =>
    row.activeTo || (row.activeFrom && row.versionNumber > 1)
      ? `${row.activeFrom ? ltrIsolate(formatDateTime(row.activeFrom)) : "…"} → ${
          row.activeTo ? ltrIsolate(formatDateTime(row.activeTo)) : t("agents.agreements.openEnded")
        }`
      : null;

  const columns: CompactDetailColumn<AgentAgreement>[] = [
    {
      id: "number",
      header: t("agents.agreements.number"),
      cell: (row) => <span className={`num ${tableIdentityCellClass}`}>{row.agreementNumber}</span>,
    },
    {
      id: "version",
      header: t("agents.agreements.version.column"),
      cell: (row) => <span className="num">{`v${row.versionNumber}`}</span>,
    },
    {
      id: "period",
      header: t("agents.agreements.period"),
      cell: (row) => (
        <span className="flex flex-col">
          <span className="num">
            {formatDate(row.effectiveFrom)} –{" "}
            {row.effectiveTo ? formatDate(row.effectiveTo) : t("agents.agreements.openEnded")}
          </span>
          {versionWindow(row) ? (
            <span className="num text-caption text-muted-foreground">{versionWindow(row)}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: "rate",
      header: t("agents.fields.commission"),
      align: "end",
      cell: (row) => <span className="num">{formatClassRates(row)}</span>,
    },
    {
      id: "status",
      header: t("agents.fields.status"),
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <StatusBadge
            label={t(`agents.agreements.status.${row.status}`)}
            tone={STATUS_TONE[row.status]}
          />
          {row.inForceNow ? (
            <StatusBadge label={t("agents.agreements.version.inForce")} tone="info" />
          ) : null}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (row) => (
        <RowActionsMenu
          label={t("common.actions")}
          actions={[
            {
              key: "view",
              label: t("agents.agreements.actions.view"),
              icon: Eye,
              onSelect: () => setViewTarget(row),
            },
            {
              key: "edit",
              label: t("agents.agreements.actions.edit"),
              icon: Pencil,
              hidden: !canManage || row.status !== "DRAFT",
              onSelect: () => setFormTarget(row),
            },
            {
              // R17 §2 — the version in force is edited as a new version.
              key: "editVersion",
              label: t("agents.agreements.actions.editVersion"),
              icon: Pencil,
              hidden: !canManage || row.status !== "ACTIVE" || !row.inForceNow,
              onSelect: () => setFormTarget(row),
            },
            {
              key: "activate",
              label: t("agents.agreements.actions.activate"),
              icon: CheckCircle2,
              hidden: !canManage || row.status !== "DRAFT",
              separatorBefore: true,
              onSelect: () => {
                setPreviewBlocked(true);
                setActivateTarget(row);
              },
            },
            {
              key: "end",
              label: t("agents.agreements.actions.end"),
              icon: StopCircle,
              hidden: !canManage || row.status !== "ACTIVE",
              destructive: true,
              separatorBefore: true,
              onSelect: () => {
                setEndDate(new Date());
                setEndTarget(row);
              },
            },
          ]}
        />
      ),
    },
  ];

  return (
    <DetailSection
      title={t("agents.agreements.title")}
      actions={
        canManage ? (
          <EnterpriseButton type="button" size="sm" onClick={() => setFormTarget("new")}>
            <Plus />
            {t("agents.agreements.new")}
          </EnterpriseButton>
        ) : null
      }
    >
      {agreements.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title={t("agents.agreements.empty")}
          description={t("agents.agreements.emptyDescription")}
        />
      ) : (
        <CompactDetailTable columns={columns} rows={agreements} rowKey={(row) => row.id} />
      )}

      {formTarget ? (
        <AgreementFormDialog
          agentId={agentId}
          currencyCode={currencyCode}
          agreement={formTarget === "new" ? null : formTarget}
          onOpenChange={(open) => !open && setFormTarget(null)}
          onSaved={refresh}
        />
      ) : null}

      {viewTarget ? (
        <EnterpriseModal
          open
          onOpenChange={(open) => {
            if (open) return;
            setViewTarget(null);
            setViewDetail(null);
          }}
          size="lg"
          title={viewTarget.agreementNumber}
          description={t(`agents.agreements.status.${viewTarget.status}`)}
          footer={
            <EnterpriseButton
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setViewTarget(null);
                setViewDetail(null);
              }}
            >
              {t("common.close")}
            </EnterpriseButton>
          }
        >
          <div className="flex flex-col gap-3">
            {viewTarget.status !== "DRAFT" ? (
              <p className="text-caption text-muted-foreground">
                {t("agents.agreements.readOnly")}
              </p>
            ) : null}
            <AgreementTerms agreement={viewTarget} />
            {viewDetail && viewDetail.id === viewTarget.id && viewDetail.activity.length > 0 ? (
              <CompactDetailTable
                columns={[
                  {
                    id: "when",
                    header: t("agents.agreements.version.when"),
                    cell: (row) => <span className="num">{formatDateTime(row.createdAt)}</span>,
                  },
                  {
                    id: "event",
                    header: t("agents.agreements.version.event"),
                    cell: (row) => {
                      const key = `agents.agreements.version.types.${row.type}` as MessageKey;
                      const label = t(key);
                      return label === key ? row.type : label;
                    },
                  },
                  {
                    id: "by",
                    header: t("agents.agreements.version.by"),
                    cell: (row) => row.user?.fullName ?? "—",
                  },
                  {
                    id: "details",
                    header: t("agents.agreements.version.details"),
                    cell: (row) => (
                      <span dir="auto" className="text-caption text-muted-foreground">
                        {localizedApiMessage(row.description, locale)}
                      </span>
                    ),
                  },
                ]}
                rows={viewDetail.activity}
                rowKey={(row) => row.id}
                stacked
              />
            ) : null}
          </div>
        </EnterpriseModal>
      ) : null}

      <ConfirmationDialog
        open={!!activateTarget}
        onOpenChange={(open) => !open && setActivateTarget(null)}
        tone="success"
        title={t("agents.agreements.confirm.activateTitle", {
          number: activateTarget?.agreementNumber ?? "",
        })}
        description={t("agents.agreements.confirm.activateDescription")}
        extra={
          activateTarget ? (
            <AgreementPreviewPanel
              agentId={agentId}
              agreementId={activateTarget.id}
              onLoaded={onPreviewLoaded}
            />
          ) : null
        }
        confirmDisabled={previewBlocked}
        size="lg"
        confirmLabel={t("agents.agreements.actions.activate")}
        isConfirming={isBusy}
        onConfirm={() => void activate()}
      />

      <ConfirmationDialog
        open={!!endTarget}
        onOpenChange={(open) => !open && setEndTarget(null)}
        tone="destructive"
        title={t("agents.agreements.confirm.endTitle", {
          number: endTarget?.agreementNumber ?? "",
        })}
        description={t("agents.agreements.confirm.endDescription")}
        extra={
          <div className="flex flex-col gap-1">
            <Label htmlFor={endFieldId}>{t("agents.agreements.confirm.endDate")}</Label>
            <EnterpriseDatePicker id={endFieldId} value={endDate} onChange={setEndDate} />
          </div>
        }
        confirmLabel={t("agents.agreements.actions.end")}
        confirmDisabled={!endDate}
        isConfirming={isBusy}
        onConfirm={() => void end()}
      />
    </DetailSection>
  );
}
