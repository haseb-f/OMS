"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorState } from "@/components/shared/error-state";
import { DetailField, DetailFieldGrid, DetailSection } from "@/components/shared/detail-workspace";
import { SemanticValue } from "@/components/shared/semantic-value";
import { useLoad } from "@/components/dashboard/dashboard-data";
import { AgreementTerms } from "@/components/agents/agreement-terms";
import { AgentOrderEntryButton } from "@/components/order-entry/agent/agent-order-entry-dialog";
import { agentsService, type AgentDetail } from "@/services/agents-service";
import { localizedName } from "@/lib/localized-name";
import { formatDate } from "@/lib/date";
import { apiErrorMessage } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import { agentOverviewApi, type AgentOverview } from "./overview-api";
import {
  LeadsOverviewPanel,
  OrdersOverviewPanel,
  PositionOverviewPanel,
  RecentOrdersPanel,
  SalesOverviewPanel,
  TeamOverviewPanel,
  type RecentOrderRow,
} from "./overview-panels";

/**
 * Company Agent → Overview (R15 W1): the agent's activity on the shared
 * agent-overview card set — orders by stage, leads, returns and the latest
 * orders for `agents.view`; sales, delivered value, collections, statement
 * position and payouts only when `GET /agents/:id/overview` returns them
 * (`agents.finance.view`); the per-employee breakdown with
 * `agents.users.view`. Staff who may enter the agent's orders get "New agent
 * order" on the orders panel.
 */
export function AgentOverviewTab({ agent }: { agent: AgentDetail }) {
  const { t, locale } = useLocale();
  const [data, setData] = useState<AgentOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currency = agent.currency?.code ?? "";

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await agentOverviewApi.agent(agent.id));
    } catch (err) {
      setError(apiErrorMessage(err, "agentOverview.loadFailed"));
    }
  }, [agent.id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const recentLoader = useMemo(
    () => () =>
      agentsService.orders(agent.id, { page: 1, pageSize: 5 }).then((page) =>
        page.items.map((row): RecentOrderRow => ({
          id: row.id,
          number: row.internalOrderId,
          date: row.orderDate,
          customer: row.partner?.name ?? null,
          total: row.total ?? null,
          currency: row.currency,
          href: `/store-orders/${row.id}`,
          status: row.fulfillmentStatus ? localizedName(row.fulfillmentStatus, locale) : null,
        })),
      ),
    [agent.id, locale],
  );
  const recent = useLoad(recentLoader);
  const reloadAll = () => {
    void load();
    void recent.retry();
  };
  const newOrder = (
    <AgentOrderEntryButton
      agent={{ id: agent.id, name: agent.name, currency: agent.currency ?? null }}
      onCreated={reloadAll}
    />
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {error ? (
        <ErrorState description={error} onRetry={() => void load()} />
      ) : (
        <>
          <OrdersOverviewPanel
            id="agent-overview-orders"
            fulfillment={data?.fulfillment ?? null}
            href={`/agents/${agent.id}?tab=orders`}
            action={newOrder}
          />
          {data ? <LeadsOverviewPanel id="agent-overview-leads" leads={data.leads} /> : null}
          {data ? (
            <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <SalesOverviewPanel
                id="agent-overview-sales"
                currency={currency}
                sales={data.sales}
                delivered={data.delivered}
                returns={data.returns}
                collections={data.collections}
              />
              <PositionOverviewPanel
                id="agent-overview-position"
                currency={currency}
                position={data.position}
                payouts={data.payouts}
                statementHref={data.position ? `/agents/${agent.id}?tab=statement` : undefined}
                payoutsHref={data.payouts ? `/agents/${agent.id}?tab=payouts` : undefined}
              />
            </div>
          ) : null}
          {data && !data.finance ? (
            <p className="text-caption text-muted-foreground">
              {t("agents.overview.financeHidden")}
            </p>
          ) : null}
          {data?.team ? (
            <TeamOverviewPanel id="agent-overview-team" rows={data.team} currency={currency} />
          ) : null}
        </>
      )}

      <RecentOrdersPanel
        id="agent-overview-recent"
        rows={recent.state.status === "ready" ? recent.state.data : null}
        failed={recent.state.status === "error"}
        onRetry={() => void recent.retry()}
        href={`/agents/${agent.id}?tab=orders`}
        emptyAction={newOrder}
      />
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
          <DetailField
            label={t("agents.overview.activeDestinations")}
            value={<span className="num">{agent.summary.activeDestinations}</span>}
          />
          <DetailField
            label={t("agents.fields.createdAt")}
            value={<SemanticValue kind="date">{formatDate(agent.createdAt)}</SemanticValue>}
          />
          <DetailField label={t("agents.fields.notes")} value={agent.notes} />
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
}
