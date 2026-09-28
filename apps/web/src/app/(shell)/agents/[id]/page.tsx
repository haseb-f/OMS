"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Archive, Pencil, Power, PowerOff } from "lucide-react";
import {
  DetailField,
  DetailFieldGrid,
  DetailSection,
  DetailWorkspace,
} from "@/components/shared/detail-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { ErrorState } from "@/components/shared/error-state";
import { PermissionGate } from "@/components/shared/permission-gate";
import { KpiCard } from "@/components/shared/kpi-card";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { EntityTabs, type EntityTab } from "@/components/business/entity-tabs";
import { StatusBadge } from "@/components/business/status-badge";
import { AgentFormDialog } from "@/components/agents/agent-form-dialog";
import { AgentAgreementsTab } from "@/components/agents/agent-agreements-tab";
import { AgreementTerms } from "@/components/agents/agreement-terms";
import { AgentDestinationsTab } from "@/components/agents/agent-destinations-tab";
import { AgentTeamTab } from "@/components/agents/agent-team-tab";
import { AgentStockTab } from "@/components/agents/agent-stock-tab";
import { AgentOrdersTab } from "@/components/agents/agent-orders-tab";
import { AgentStatementTab } from "@/components/agents/agent-statement-tab";
import { AgentPayoutsTab } from "@/components/agents/agent-payouts";
import { PendingPostingsBanner } from "@/components/agents/pending-postings-banner";
import {
  agentFinanceService,
  agentsService,
  type AgentDashboard,
  type AgentDetail,
} from "@/services/agents-service";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate } from "@/lib/date";
import { apiErrorMessage, reportApiError, toast } from "@/lib/toast";
import { invalidateLookups } from "@/lib/lookup-cache";
import type { MessageKey } from "@/i18n/translate";

export default function AgentWorkspacePage() {
  return (
    <PermissionGate permission="agents.view">
      <AgentWorkspace />
    </PermissionGate>
  );
}

function AgentWorkspace() {
  const params = useParams<{ id: string }>();
  // `?tab=team` etc. — deep links (e.g. the Users page's "Open agent team").
  const requestedTab = useSearchParams()?.get("tab") ?? null;
  const router = useRouter();
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canEdit = hasPermission("agents.edit");
  const canArchive = hasPermission("agents.archive");
  const canViewFinance = hasPermission("agents.finance.view");
  const canViewTeam = hasPermission("agents.users.view");

  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [dashboard, setDashboard] = useState<AgentDashboard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [statusConfirm, setStatusConfirm] = useState<"activate" | "deactivate" | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setAgent(await agentsService.get(params.id));
    } catch (error) {
      setLoadError(apiErrorMessage(error, "errors.loadFailed"));
    }
  }, [params.id]);

  const loadDashboard = useCallback(async () => {
    if (!canViewFinance) return;
    try {
      setDashboard(await agentFinanceService.dashboard(params.id));
    } catch (error) {
      reportApiError(error, "errors.loadFailed");
    }
  }, [params.id, canViewFinance]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadDashboard();
  }, [load, loadDashboard]);

  useBreadcrumbLabel(agent?.name ?? null);

  const refreshAll = () => {
    void load();
    void loadDashboard();
  };

  const changeStatus = async () => {
    if (!agent || !statusConfirm) return;
    setIsBusy(true);
    try {
      const updated =
        statusConfirm === "activate"
          ? await agentsService.activate(agent.id)
          : await agentsService.deactivate(agent.id);
      setAgent(updated);
      invalidateLookups("agents:");
      toast.success(
        statusConfirm === "activate"
          ? t("agents.toasts.activated")
          : t("agents.toasts.deactivated"),
      );
      setStatusConfirm(null);
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsBusy(false);
    }
  };

  const archive = async () => {
    if (!agent) return;
    try {
      await agentsService.archive(agent.id);
      invalidateLookups("agents:");
      toast.success(t("agents.toasts.archived"));
      router.push("/agents");
    } catch (error) {
      reportApiError(error, "errors.generic");
    }
  };

  if (loadError) return <ErrorState description={loadError} onRetry={() => void load()} />;
  if (!agent) return null;

  const currency = agent.currency?.code ?? "";
  const agentLabel = `${agent.name} · ${agent.agentNumber}`;
  const position = dashboard?.position;

  const overview = (
    <div className="flex flex-col gap-3">
      {canViewFinance ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <KpiCard
            size="compact"
            label={t("agents.overview.balance")}
            isLoading={!dashboard}
            value={
              position ? <MoneyValue value={position.balance} currency={currency} /> : undefined
            }
          />
          <KpiCard
            size="compact"
            label={t("agents.overview.available")}
            isLoading={!dashboard}
            value={
              position ? <MoneyValue value={position.available} currency={currency} /> : undefined
            }
          />
          <KpiCard
            size="compact"
            label={t("agents.overview.pending")}
            isLoading={!dashboard}
            value={
              position ? <MoneyValue value={position.pending} currency={currency} /> : undefined
            }
          />
          <KpiCard
            size="compact"
            label={t("agents.overview.paidOut")}
            isLoading={!dashboard}
            value={
              position ? <MoneyValue value={position.paidOut} currency={currency} /> : undefined
            }
          />
          <KpiCard
            size="compact"
            label={t("agents.overview.awaitingVerification")}
            isLoading={!dashboard}
            value={
              dashboard ? (
                <SemanticValue kind="number">
                  {dashboard.collections.awaitingVerificationCount}
                </SemanticValue>
              ) : undefined
            }
            href={
              hasPermission("agents.finance.view")
                ? `/agents/collections?agentId=${agent.id}`
                : undefined
            }
          />
          <KpiCard
            size="compact"
            label={t("agents.overview.totalOrderValue")}
            isLoading={!dashboard}
            value={
              dashboard ? (
                <MoneyValue value={dashboard.sales.totalOrderValue} currency={currency} />
              ) : undefined
            }
          />
        </div>
      ) : (
        <p className="text-caption text-muted-foreground">{t("agents.overview.financeHidden")}</p>
      )}
      <p className="text-caption text-muted-foreground">{t("agents.signNote")}</p>

      <DetailSection title={t("agents.overview.identity")}>
        <DetailFieldGrid columns={3}>
          <DetailField label={t("agents.fields.legalName")} value={agent.legalName} />
          <DetailField label={t("agents.fields.contactName")} value={agent.contactName} />
          <DetailField
            label={t("agents.fields.phone")}
            value={agent.phone ? <SemanticValue kind="phone">{agent.phone}</SemanticValue> : null}
          />
          <DetailField
            label={t("agents.fields.email")}
            value={agent.email ? <SemanticValue kind="email">{agent.email}</SemanticValue> : null}
          />
          <DetailField label={t("agents.fields.address")} value={agent.address} />
          <DetailField label={t("agents.fields.currency")} value={currency} />
          <DetailField
            label={t("agents.fields.partner")}
            value={agent.partner ? `${agent.partner.name} · ${agent.partner.partnerNumber}` : null}
          />
          <DetailField label={t("agents.fields.createdAt")} value={formatDate(agent.createdAt)} />
          <DetailField label={t("agents.fields.notes")} value={agent.notes} />
        </DetailFieldGrid>
      </DetailSection>

      <DetailSection title={t("agents.overview.fulfillmentTitle")}>
        <DetailFieldGrid columns={4}>
          <DetailField
            label={t("agents.overview.openOrders")}
            value={<span className="num">{agent.summary.openOrders}</span>}
          />
          <DetailField
            label={t("agents.overview.activeDestinations")}
            value={<span className="num">{agent.summary.activeDestinations}</span>}
          />
          {dashboard ? (
            <>
              <DetailField
                label={t("agents.overview.awaitingDispatch")}
                value={<span className="num">{dashboard.fulfillment.awaitingDispatch}</span>}
              />
              <DetailField
                label={t("agents.overview.completed")}
                value={<span className="num">{dashboard.fulfillment.completed}</span>}
              />
              <DetailField
                label={t("agents.overview.withReturns")}
                value={<span className="num">{dashboard.fulfillment.withReturns}</span>}
              />
              <DetailField
                label={t("agents.overview.merchandiseSales")}
                value={
                  <MoneyValue
                    value={dashboard.sales.merchandiseSalesExShipping}
                    currency={currency}
                  />
                }
              />
              <DetailField
                label={t("agents.overview.lastPayout")}
                value={
                  dashboard.payouts.last
                    ? `${dashboard.payouts.last.payoutNumber} · ${formatDate(dashboard.payouts.last.payoutDate)}`
                    : null
                }
              />
            </>
          ) : null}
        </DetailFieldGrid>
      </DetailSection>

      <DetailSection
        title={
          agent.activeAgreement
            ? `${t("agents.agreements.activeTerms")} · ${agent.activeAgreement.agreementNumber}`
            : t("agents.agreements.activeTerms")
        }
      >
        {agent.activeAgreement ? (
          <AgreementTerms agreement={agent.activeAgreement} />
        ) : (
          <p className="text-caption text-muted-foreground">{t("agents.noActiveAgreement")}</p>
        )}
      </DetailSection>
    </div>
  );

  const tabs: EntityTab[] = [
    { value: "overview", label: t("agents.tabs.overview"), content: overview },
    {
      value: "agreements",
      label: t("agents.tabs.agreements"),
      content: (
        <AgentAgreementsTab
          agentId={agent.id}
          currencyCode={currency}
          onChanged={() => void load()}
        />
      ),
    },
    {
      value: "destinations",
      label: t("agents.tabs.destinations"),
      content: (
        <AgentDestinationsTab
          agentId={agent.id}
          allowAgentDestinations={agent.activeAgreement?.allowAgentDestinations ?? null}
        />
      ),
    },
    ...(canViewTeam
      ? [
          {
            value: "team",
            label: t("agents.tabs.team"),
            content: <AgentTeamTab agentId={agent.id} agentActive={agent.status === "ACTIVE"} />,
          },
        ]
      : []),
    {
      value: "stock",
      label: t("agents.tabs.stock"),
      content: <AgentStockTab agentId={agent.id} agentLabel={agentLabel} />,
    },
    {
      value: "orders",
      label: t("agents.tabs.orders"),
      content: <AgentOrdersTab agentId={agent.id} agentLabel={agentLabel} />,
    },
    ...(canViewFinance
      ? [
          {
            value: "statement",
            label: t("agents.tabs.statement"),
            content: <AgentStatementTab agentId={agent.id} />,
          },
          {
            value: "payouts",
            label: t("agents.tabs.payouts"),
            content: (
              <AgentPayoutsTab agentId={agent.id} agentLabel={agentLabel} onChanged={refreshAll} />
            ),
          },
        ]
      : []),
  ];

  return (
    <DetailWorkspace
      title={agent.name}
      reference={agent.agentNumber}
      status={
        <StatusBadge
          label={t(`agents.status.${agent.status}` as MessageKey)}
          tone={agent.status === "ACTIVE" ? "success" : "neutral"}
        />
      }
      meta={[currency, agent.contactName, agent.phone].filter(Boolean).join(" · ")}
      actions={
        <HeaderActions
          primary={{
            key: "edit",
            label: t("agents.actions.edit"),
            icon: Pencil,
            hidden: !canEdit,
            onSelect: () => setEditOpen(true),
          }}
          secondary={[
            {
              key: "status",
              label:
                agent.status === "ACTIVE"
                  ? t("agents.actions.deactivate")
                  : t("agents.actions.activate"),
              icon: agent.status === "ACTIVE" ? PowerOff : Power,
              hidden: !canEdit,
              onSelect: () =>
                setStatusConfirm(agent.status === "ACTIVE" ? "deactivate" : "activate"),
            },
          ]}
          destructive={[
            {
              key: "archive",
              label: t("agents.actions.archive"),
              icon: Archive,
              hidden: !canArchive,
              confirm: {
                title: t("agents.confirm.archiveTitle"),
                description: t("agents.confirm.archiveDescription"),
                confirmLabel: t("agents.actions.archive"),
              },
              onSelect: archive,
            },
          ]}
        />
      }
    >
      <PendingPostingsBanner agentId={agent.id} onPosted={refreshAll} />
      <EntityTabs
        tabs={tabs}
        defaultValue={tabs.some((tab) => tab.value === requestedTab) ? requestedTab! : undefined}
      />

      {editOpen ? (
        <AgentFormDialog agent={agent} onOpenChange={setEditOpen} onSaved={setAgent} />
      ) : null}

      <ConfirmationDialog
        open={!!statusConfirm}
        onOpenChange={(open) => !open && setStatusConfirm(null)}
        tone={statusConfirm === "deactivate" ? "destructive" : "success"}
        title={
          statusConfirm === "deactivate"
            ? t("agents.confirm.deactivateTitle")
            : t("agents.confirm.activateTitle")
        }
        description={
          statusConfirm === "deactivate"
            ? t("agents.confirm.deactivateDescription")
            : t("agents.confirm.activateDescription")
        }
        confirmLabel={
          statusConfirm === "deactivate"
            ? t("agents.actions.deactivate")
            : t("agents.actions.activate")
        }
        isConfirming={isBusy}
        onConfirm={() => void changeStatus()}
      />
    </DetailWorkspace>
  );
}
