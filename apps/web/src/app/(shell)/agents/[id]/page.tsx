"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Archive, Pencil, Power, PowerOff } from "lucide-react";
import { DetailWorkspace } from "@/components/shared/detail-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { ErrorState } from "@/components/shared/error-state";
import { PermissionGate } from "@/components/shared/permission-gate";
import { EntityTabs, type EntityTab } from "@/components/business/entity-tabs";
import { StatusBadge } from "@/components/business/status-badge";
import { AgentFormDialog } from "@/components/agents/agent-form-dialog";
import { AgentAgreementsTab } from "@/components/agents/agent-agreements-tab";
import { AgentDestinationsTab } from "@/components/agents/agent-destinations-tab";
import { AgentTeamTab } from "@/components/agents/agent-team-tab";
import { AgentStockTab } from "@/components/agents/agent-stock-tab";
import { AgentProductsTab } from "@/components/agents/agent-products-tab";
import { AgentOrdersTab } from "@/components/agents/agent-orders-tab";
import { AgentStatementTab } from "@/components/agents/agent-statement-tab";
import { AgentCommissionReportView } from "@/components/agents/agent-commission-report";
import { AgentPayoutsTab } from "@/components/agents/agent-payouts";
import { PendingPostingsBanner } from "@/components/agents/pending-postings-banner";
import { AgentOverviewTab } from "@/components/agents/overview/agent-overview-tab";
import { ShippingAgreementSection } from "@/components/agents/shipping-agreements/shipping-agreement-section";
import { agentFinanceService, agentsService, type AgentDetail } from "@/services/agents-service";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { apiErrorMessage, reportApiError, toast } from "@/lib/toast";
import { invalidateLookups } from "@/lib/lookup-cache";
import type { MessageKey } from "@/i18n/translate";
import { ltrIsolate } from "@/lib/bidi";

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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useBreadcrumbLabel(agent?.name ?? null);

  const refreshAll = () => {
    void load();
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

  const overview = <AgentOverviewTab agent={agent} />;

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
      value: "products",
      label: t("agents.tabs.products"),
      content: (
        <AgentProductsTab
          agentId={agent.id}
          agentLabel={agentLabel}
          agentActive={agent.status === "ACTIVE"}
        />
      ),
    },
    {
      value: "stock",
      label: t("agents.tabs.stock"),
      content: <AgentStockTab agentId={agent.id} agentLabel={agentLabel} />,
    },
    {
      value: "orders",
      label: t("agents.tabs.orders"),
      content: (
        <AgentOrdersTab
          agentId={agent.id}
          agentLabel={agentLabel}
          entryTarget={{ id: agent.id, name: agent.name, currency: agent.currency ?? null }}
        />
      ),
    },
    ...(canViewFinance
      ? [
          {
            value: "statement",
            label: t("agents.tabs.statement"),
            content: <AgentStatementTab agentId={agent.id} />,
          },
          {
            value: "commission",
            label: t("agents.tabs.commission"),
            content: (
              <AgentCommissionReportView
                load={(params) => agentFinanceService.commissionReport(agent.id, params)}
                orderHref={(storeOrderId) => `/store-orders/${storeOrderId}`}
                exportName={`${agent.agentNumber}-commission.csv`}
              />
            ),
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
    {
      value: "settings",
      label: t("agentShippingAgreements.tab"),
      content: <ShippingAgreementSection agentId={agent.id} currencyCode={currency} />,
    },
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
      // Codes and the phone are isolated left-to-right runs ("+2010…" never reads "…2010+").
      meta={[
        currency && ltrIsolate(currency),
        agent.contactName,
        agent.phone && ltrIsolate(agent.phone),
      ]
        .filter(Boolean)
        .join(" · ")}
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
        // A drill-down to `?tab=…` (overview panels) opens that tab.
        key={requestedTab ?? "overview"}
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
