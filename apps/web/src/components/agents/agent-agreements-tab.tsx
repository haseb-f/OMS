"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { CheckCircle2, Eye, FileSignature, MapPin, Pencil, Plus, StopCircle } from "lucide-react";
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
import { agentsService, type AgentAgreement } from "@/services/agents-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate, toISODate } from "@/lib/date";
import { formatAmount } from "@/lib/money";
import { apiErrorMessage, reportApiError, toast } from "@/lib/toast";
import { AgreementFormDialog } from "./agreement-form-dialog";
import { AgreementTerms } from "./agreement-terms";
import { ShippingRatesDialog } from "./shipping-rates-dialog";

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
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canManage = hasPermission("agents.agreements.manage");
  const endFieldId = useId();
  const [agreements, setAgreements] = useState<AgentAgreement[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<AgentAgreement | "new" | null>(null);
  const [viewTarget, setViewTarget] = useState<AgentAgreement | null>(null);
  const [ratesTarget, setRatesTarget] = useState<AgentAgreement | null>(null);
  const [activateTarget, setActivateTarget] = useState<AgentAgreement | null>(null);
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

  const refresh = () => {
    void load();
    onChanged();
  };

  const activate = async () => {
    if (!activateTarget) return;
    setIsBusy(true);
    try {
      await agentsService.agreements.activate(agentId, activateTarget.id);
      toast.success(t("agents.agreements.toasts.activated"));
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

  const columns: CompactDetailColumn<AgentAgreement>[] = [
    {
      id: "number",
      header: t("agents.agreements.number"),
      cell: (row) => <span className={`num ${tableIdentityCellClass}`}>{row.agreementNumber}</span>,
    },
    {
      id: "period",
      header: t("agents.agreements.period"),
      cell: (row) => (
        <span className="num">
          {formatDate(row.effectiveFrom)} –{" "}
          {row.effectiveTo ? formatDate(row.effectiveTo) : t("agents.agreements.openEnded")}
        </span>
      ),
    },
    {
      id: "rate",
      header: t("agents.fields.commission"),
      align: "end",
      cell: (row) => (
        <span className="num">{formatAmount(Number(row.commissionRatePercent))}%</span>
      ),
    },
    {
      id: "status",
      header: t("agents.fields.status"),
      cell: (row) => (
        <StatusBadge
          label={t(`agents.agreements.status.${row.status}`)}
          tone={STATUS_TONE[row.status]}
        />
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
              key: "rates",
              label: t("agents.agreements.actions.rates"),
              icon: MapPin,
              onSelect: () => setRatesTarget(row),
            },
            {
              key: "activate",
              label: t("agents.agreements.actions.activate"),
              icon: CheckCircle2,
              hidden: !canManage || row.status !== "DRAFT",
              separatorBefore: true,
              onSelect: () => setActivateTarget(row),
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

      {ratesTarget ? (
        <ShippingRatesDialog
          agentId={agentId}
          agreement={ratesTarget}
          canManage={canManage}
          onOpenChange={(open) => !open && setRatesTarget(null)}
          onChanged={() => void load()}
        />
      ) : null}

      {viewTarget ? (
        <EnterpriseModal
          open
          onOpenChange={(open) => !open && setViewTarget(null)}
          size="lg"
          title={viewTarget.agreementNumber}
          description={t(`agents.agreements.status.${viewTarget.status}`)}
          footer={
            <EnterpriseButton
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setViewTarget(null)}
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
