"use client";

import { useEffect, useState } from "react";
import { Clock, Package, RotateCcw, Store, Users } from "lucide-react";
import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { InsightCard, InsightCardSkeleton, InsightGroup } from "@/components/shared/insight-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { ListPager } from "@/components/shared/list-pager";
import { agentsService } from "@/services/agents-service";
import { apiErrorMessage } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import { agentOverviewApi, type AgentsOverview } from "./overview-api";
import { BreakdownCards, countRows } from "./overview-panels";

/** Agents per page of the "By agent" cards — well under the API cap (50 ids). */
export const AGENTS_OVERVIEW_PAGE_SIZE = 12;

/**
 * The company Agents overview (R15 W1 figures; R16 S2 its own destination,
 * `/agents/overview`, `agents.view`): company-wide counts (active agents, open
 * orders, orders with returns, leads, payments awaiting Finance with
 * `agents.finance.view`), then one summary card per agent, a page at a time —
 * the overview never asks for more agents than one page. Money (order value,
 * delivered value, available for payout) is per agent in its own currency and
 * only when the API returns it. Read-only: the table, search, create and edit
 * live on Agent management (`/agents`); a card opens that agent's own page.
 */
export function AgentsOverview() {
  const { t, direction } = useLocale();
  const [page, setPage] = useState(0);
  const [agents, setAgents] = useState<{ ids: string[]; total: number } | null>(null);
  const [data, setData] = useState<AgentsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    agentsService
      .list({ page: page + 1, pageSize: AGENTS_OVERVIEW_PAGE_SIZE })
      .then(async (result) => {
        const ids = result.items.map((row) => row.id);
        const overview = await agentOverviewApi.agents(ids);
        if (cancelled) return;
        setAgents({ ids, total: result.total });
        setData(overview);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, "agentOverview.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [page, attempt]);

  if (error) {
    return <ErrorState description={error} onRetry={() => setAttempt((value) => value + 1)} />;
  }

  const totals = data?.totals;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <InsightGroup fit aria-busy={!totals || undefined}>
        {totals ? (
          <>
            <InsightCard
              direction={direction}
              icon={Store}
              tone="info"
              label={t("agentOverview.agents.activeAgents")}
              value={totals.agents.active}
              context={t("agentOverview.agents.agentsContext", { total: totals.agents.total })}
            />
            <InsightCard
              direction={direction}
              icon={Package}
              tone="warning"
              label={t("agentOverview.agents.openOrders")}
              value={totals.orders.open}
              context={t("agentOverview.agents.openOrdersContext")}
            />
            <InsightCard
              direction={direction}
              icon={RotateCcw}
              tone="destructive"
              label={t("agentOverview.agents.withReturns")}
              value={totals.orders.withReturns}
            />
            <InsightCard
              direction={direction}
              icon={Users}
              tone="info"
              label={t("agentOverview.agents.leads")}
              value={totals.leads.total}
              context={t("agentOverview.agents.leadsContext", { count: totals.leads.fresh })}
            />
            {totals.collections ? (
              <InsightCard
                direction={direction}
                icon={Clock}
                tone="warning"
                label={t("agentOverview.agents.awaitingVerification")}
                value={totals.collections.awaitingVerificationCount}
                href="/agents/collections"
              />
            ) : null}
          </>
        ) : (
          Array.from({ length: 4 }, (_, index) => <InsightCardSkeleton key={index} context />)
        )}
      </InsightGroup>

      <DashboardPanel
        id="agents-overview-by-agent"
        icon={Store}
        tone="info"
        title={t("agentOverview.agents.byAgentTitle")}
        description={t("agentOverview.agents.byAgentDescription")}
        scope={{ kind: "current", label: t("insights.scope.current") }}
        busy={!data}
      >
        {data && agents ? (
          data.items.length > 0 ? (
            <div className="flex min-w-0 flex-col">
              <BreakdownCards
                icon={Store}
                cards={data.items.map((row) => ({
                  key: row.agent.id,
                  title: `${row.agent.name} · ${row.agent.agentNumber}`,
                  currency: row.agent.currency?.code ?? "",
                  tone: row.fulfillment.awaitingDispatch > 0 ? "warning" : "neutral",
                  href: `/agents/${row.agent.id}`,
                  rows: [
                    ...countRows(t, row),
                    ...(row.sales
                      ? [
                          {
                            label: t("agentPortal.dashboard.kpi.totalOrderValue"),
                            value: row.sales.totalOrderValue,
                          },
                        ]
                      : []),
                    ...(row.delivered
                      ? [{ label: t("agentOverview.delivered"), value: row.delivered.value }]
                      : []),
                    ...(row.collections
                      ? [
                          {
                            label: t("agentOverview.agents.awaitingVerification"),
                            value: String(row.collections.awaitingVerificationCount),
                          },
                        ]
                      : []),
                    ...(row.position
                      ? [
                          {
                            label: t("agentOverview.agents.availableForPayout"),
                            value: row.position.available,
                            emphasis: true,
                          },
                        ]
                      : []),
                  ],
                }))}
              />
              <div className="px-3 pb-3">
                <ListPager
                  page={page}
                  pageSize={AGENTS_OVERVIEW_PAGE_SIZE}
                  total={agents.total}
                  onPageChange={setPage}
                />
              </div>
            </div>
          ) : (
            <EmptyState title={t("agents.list.empty")} />
          )
        ) : (
          <InsightGroup fit className="p-3" aria-hidden>
            {Array.from({ length: 3 }, (_, index) => (
              <InsightCardSkeleton key={index} context />
            ))}
          </InsightGroup>
        )}
      </DashboardPanel>
    </div>
  );
}
