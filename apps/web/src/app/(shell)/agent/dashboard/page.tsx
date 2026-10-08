"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { ErrorState } from "@/components/shared/error-state";
import { EnterpriseButton } from "@/components/ui/button";
import { useLoad } from "@/components/dashboard/dashboard-data";
import {
  FulfillmentStatusBadge,
  DeclaredStatusBadge,
} from "@/components/agent-portal/portal-badges";
import {
  LeadsOverviewPanel,
  OrdersOverviewPanel,
  PositionOverviewPanel,
  RecentOrdersPanel,
  SalesOverviewPanel,
  TeamOverviewPanel,
  type RecentOrderRow,
} from "@/components/agents/overview/overview-panels";
import {
  agentOverviewApi,
  type AgentPortalDashboard,
} from "@/components/agents/overview/overview-api";
import { agentPortalService } from "@/services/agent-portal-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { apiErrorMessage } from "@/lib/toast";

/**
 * Agent dashboard (R15 W1) on the shared agent-overview card set, fed only by
 * the scoped `GET /agent-portal/dashboard` (+ the latest orders). What a panel
 * shows is what the API returned for this user — an employee sees their own
 * orders, leads and their own sales value / delivered value / returns; agent
 * money (statement, payouts, collections) only with `agent.statement.view` in
 * the agent-wide scope; the per-employee breakdown only with
 * `agent.reports.view_team`. A null block is hidden, never shown as zero.
 */
export default function AgentDashboardPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();
  const canViewOrders = hasPermission("agent.orders.view");
  const canCreateOrders = hasPermission("agent.orders.create");
  const [data, setData] = useState<AgentPortalDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The latest orders load on their own: a failure shows that panel's error + retry.
  const recentLoader = useMemo(
    () => () =>
      canViewOrders
        ? agentPortalService.orders.list({ page: 1, pageSize: 5 }).then((page) =>
            page.items.map((row): RecentOrderRow => ({
              id: row.id,
              number: row.internalOrderId,
              date: row.orderDate,
              customer: row.customer?.name ?? null,
              total: row.breakdown.payableTotal,
              currency: row.currency,
              href: `/agent/orders/${row.id}`,
              status: (
                <span className="flex flex-wrap gap-1">
                  <FulfillmentStatusBadge status={row.fulfillmentStatus} />
                  <DeclaredStatusBadge status={row.declaredPaymentStatus} />
                </span>
              ),
            })),
          )
        : Promise.resolve(null),
    [canViewOrders],
  );
  const recent = useLoad(recentLoader);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await agentOverviewApi.portalDashboard());
    } catch (err) {
      setError(apiErrorMessage(err, "agentPortal.common.loadFailed"));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error) return <ErrorState description={error} onRetry={() => void load()} />;

  const currency = data?.agent.currency ?? null;
  const newOrderAction = canCreateOrders ? (
    <EnterpriseButton asChild size="sm">
      <Link href="/agent/orders/new">
        <ShoppingCart data-icon="inline-start" />
        {t("agentPortal.dashboard.newOrder")}
      </Link>
    </EnterpriseButton>
  ) : undefined;
  const statementHref =
    hasPermission("agent.statement.view") && data?.position ? "/agent/statement" : undefined;
  const payoutsHref =
    hasPermission("agent.payouts.view") && data?.payouts ? "/agent/payouts" : undefined;

  return (
    <PageWorkspace
      title={data ? data.agent.name : t("agentPortal.dashboard.title")}
      description={
        data
          ? `${t("agentPortal.identity.number", { number: data.agent.agentNumber })} · ${t(
              data.scope === "OWN" ? "agentPortal.common.scopeOwn" : "agentPortal.common.scopeAll",
            )}`
          : t("agentPortal.dashboard.description")
      }
      actions={
        <HeaderActions
          primary={{
            key: "new-order",
            label: t("agentPortal.dashboard.newOrder"),
            icon: ShoppingCart,
            hidden: !canCreateOrders,
            onSelect: () => router.push("/agent/orders/new"),
          }}
        />
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        <OrdersOverviewPanel
          id="agent-orders"
          fulfillment={data?.fulfillment ?? null}
          description={
            data
              ? t(data.scope === "OWN" ? "insights.agent.ordersOwn" : "insights.agent.ordersAll")
              : undefined
          }
          href={canViewOrders ? "/agent/orders" : undefined}
          emptyAction={newOrderAction}
        />

        {data?.leads ? (
          <LeadsOverviewPanel id="agent-leads" leads={data.leads} href="/agent/leads" />
        ) : null}

        {data ? (
          <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <SalesOverviewPanel
              id="agent-sales"
              currency={currency}
              title={data.own ? t("agentOverview.ownSalesTitle") : undefined}
              sales={data.sales}
              own={data.own}
              delivered={
                data.own ? { count: data.own.deliveredCount, value: data.own.deliveredValue } : null
              }
              returns={data.returns}
              returnCount={data.own?.returnCount}
              collections={data.collections}
            />
            <PositionOverviewPanel
              id="agent-position"
              currency={currency}
              position={data.position}
              payouts={data.payouts}
              statementHref={statementHref}
              payoutsHref={payoutsHref}
            />
          </div>
        ) : null}

        {data?.team ? (
          <TeamOverviewPanel id="agent-team" rows={data.team} currency={currency?.code ?? ""} />
        ) : null}

        {canViewOrders ? (
          <RecentOrdersPanel
            id="agent-recent"
            rows={recent.state.status === "ready" ? recent.state.data : null}
            failed={recent.state.status === "error"}
            onRetry={() => void recent.retry()}
            href="/agent/orders"
            emptyAction={newOrderAction}
          />
        ) : null}
      </div>
    </PageWorkspace>
  );
}
