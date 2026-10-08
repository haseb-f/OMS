"use client";

import { useEffect, useState } from "react";
import { Clock, Package, RotateCcw, Store, Users } from "lucide-react";
import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { InsightCard, InsightCardSkeleton, InsightGroup } from "@/components/shared/insight-card";
import { ErrorState } from "@/components/shared/error-state";
import { apiErrorMessage } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import { agentOverviewApi, type AgentsOverview } from "./overview-api";
import { BreakdownCards, countRows } from "./overview-panels";

/**
 * The cross-agent overview of the Agents page (R15 W1, `agents.view`):
 * company-wide counts (active agents, open orders, orders with returns, leads,
 * payments awaiting Finance with `agents.finance.view`) and one card per agent
 * shown on the list's current page — the overview never loads more agents
 * than the list. Money (order value, delivered value, available for payout) is
 * per agent in its own currency, and only when the API returns it.
 */
export function AgentsOverviewPanel({
  agentIds,
  ready,
}: {
  /** The agents on the list's current page. */
  agentIds: readonly string[];
  /** The list page has loaded (one request per page, never one per render). */
  ready: boolean;
}) {
  const { t, direction } = useLocale();
  const [data, setData] = useState<AgentsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const idsKey = agentIds.join(",");

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    agentOverviewApi
      .agents(idsKey ? idsKey.split(",") : [])
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, "agentOverview.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [idsKey, attempt, ready]);

  const totals = data?.totals;
  return (
    <DashboardPanel
      id="agents-overview"
      icon={Store}
      tone="info"
      title={t("agentOverview.agents.title")}
      description={t("agentOverview.agents.description")}
      scope={{ kind: "current", label: t("insights.scope.current") }}
      busy={!data && !error}
    >
      {error ? (
        <ErrorState description={error} onRetry={() => setAttempt((value) => value + 1)} />
      ) : (
        <div className="flex min-w-0 flex-col">
          <InsightGroup fit className="p-3">
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
                  />
                ) : null}
              </>
            ) : (
              Array.from({ length: 4 }, (_, index) => <InsightCardSkeleton key={index} />)
            )}
          </InsightGroup>
          {data && data.items.length > 0 ? (
            <div className="border-t border-border">
              <h3 className="px-3 pt-3 text-caption font-semibold text-muted-foreground">
                {t("agentOverview.agents.byAgentTitle")}
              </h3>
              <BreakdownCards
                cards={data.items.map((row) => ({
                  key: row.agent.id,
                  title: `${row.agent.name} · ${row.agent.agentNumber}`,
                  currency: row.agent.currency?.code ?? "",
                  tone: row.fulfillment.awaitingDispatch > 0 ? "warning" : "neutral",
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
            </div>
          ) : null}
        </div>
      )}
    </DashboardPanel>
  );
}
