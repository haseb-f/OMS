"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban,
  Banknote,
  CheckCircle2,
  Clock,
  HandCoins,
  Hourglass,
  Package,
  RotateCcw,
  ShoppingCart,
  Truck,
  Undo2,
  Wallet,
} from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { KpiCard } from "@/components/shared/kpi-card";
import { ErrorState } from "@/components/shared/error-state";
import { DetailSection } from "@/components/shared/detail-workspace";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { SectionHeading } from "@/components/shared/section-heading";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { Progress } from "@/components/ui/progress";
import {
  FulfillmentStatusBadge,
  DeclaredStatusBadge,
} from "@/components/agent-portal/portal-badges";
import { stageShares } from "@/config/agent-portal/labels";
import {
  agentPortalService,
  type PortalDashboard,
  type PortalOrderRow,
} from "@/services/agent-portal-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { apiErrorMessage } from "@/lib/toast";
import { formatDate } from "@/lib/date";
import type { LucideIcon } from "lucide-react";

const STAGE_ICONS: Record<string, LucideIcon> = {
  awaitingDispatch: Hourglass,
  dispatched: Truck,
  completed: CheckCircle2,
  withReturns: RotateCcw,
  cancelled: Ban,
};

const METRIC_GRID = "grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))]";

/**
 * Agent dashboard (spec §10): fulfillment progress by stage, then money
 * figures — shown only when the API returns them (`agent.statement.view`);
 * a null block is hidden, never rendered as zero — and the latest orders.
 */
export default function AgentDashboardPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();
  const canViewOrders = hasPermission("agent.orders.view");
  const [data, setData] = useState<PortalDashboard | null>(null);
  const [recent, setRecent] = useState<PortalOrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await agentPortalService.dashboard());
    } catch (err) {
      setError(apiErrorMessage(err, "agentPortal.common.loadFailed"));
    }
    if (canViewOrders) {
      agentPortalService.orders
        .list({ page: 1, pageSize: 5 })
        .then((page) => setRecent(page.items))
        .catch(() => setRecent([]));
    }
  }, [canViewOrders]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const currency = data?.agent.currency ?? null;
  const money = (value: number) => <MoneyValue value={value} currency={currency} />;

  const recentColumns: CompactDetailColumn<PortalOrderRow>[] = [
    {
      id: "number",
      header: t("agentPortal.orders.fields.number"),
      cell: (row) => (
        <StackedCell
          primary={
            <Link href={`/agent/orders/${row.id}`} className="hover:underline">
              <SemanticValue kind="id">{row.internalOrderId}</SemanticValue>
            </Link>
          }
          secondary={<span className="num">{formatDate(row.orderDate)}</span>}
        />
      ),
    },
    {
      id: "customer",
      header: t("agentPortal.orders.fields.customer"),
      cell: (row) => row.customer?.name ?? "—",
    },
    {
      id: "payable",
      header: t("agentPortal.orders.fields.payable"),
      align: "end",
      cell: (row) => <MoneyValue value={row.breakdown.payableTotal} currency={row.currency} />,
    },
    {
      id: "status",
      header: t("agentPortal.orders.fields.fulfillment"),
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          <FulfillmentStatusBadge status={row.fulfillmentStatus} />
          <DeclaredStatusBadge status={row.declaredPaymentStatus} />
        </span>
      ),
    },
  ];

  if (error) return <ErrorState description={error} onRetry={() => void load()} />;

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
            hidden: !hasPermission("agent.orders.create"),
            onSelect: () => router.push("/agent/orders/new"),
          }}
        />
      }
    >
      <section className="flex flex-col gap-2">
        <SectionHeading title={t("agentPortal.dashboard.fulfillmentTitle")} />
        <div className={METRIC_GRID}>
          <KpiCard
            size="compact"
            icon={Package}
            label={t("agentPortal.dashboard.stages.total")}
            value={data ? <span className="num">{data.fulfillment.total}</span> : undefined}
            isLoading={!data}
            href={canViewOrders ? "/agent/orders" : undefined}
          />
          {data
            ? stageShares(data.fulfillment).map((stage) => (
                <KpiCard
                  key={stage.key}
                  size="compact"
                  icon={STAGE_ICONS[stage.key]}
                  tone={
                    stage.key === "cancelled"
                      ? "muted"
                      : stage.key === "completed"
                        ? "success"
                        : "primary"
                  }
                  label={t(`agentPortal.dashboard.stages.${stage.key}`)}
                  value={<span className="num">{stage.count}</span>}
                  description={
                    <span className="flex items-center gap-2">
                      <Progress value={stage.percent} className="h-1 flex-1" aria-hidden />
                      <span className="num">{stage.percent}%</span>
                    </span>
                  }
                />
              ))
            : null}
        </div>
      </section>

      {data && (data.sales || data.returns || data.collections || data.position || data.payouts) ? (
        <section className="flex flex-col gap-2">
          <SectionHeading title={t("agentPortal.dashboard.moneyTitle")} />
          <div className={METRIC_GRID}>
            {data.sales ? (
              <>
                <KpiCard
                  size="compact"
                  icon={ShoppingCart}
                  label={t("agentPortal.dashboard.kpi.salesExShipping")}
                  value={money(data.sales.merchandiseSalesExShipping)}
                />
                <KpiCard
                  size="compact"
                  icon={Truck}
                  label={t("agentPortal.dashboard.kpi.shippingCharges")}
                  value={money(data.sales.customerShippingCharges)}
                />
                <KpiCard
                  size="compact"
                  icon={Banknote}
                  label={t("agentPortal.dashboard.kpi.totalOrderValue")}
                  value={money(data.sales.totalOrderValue)}
                />
              </>
            ) : null}
            {data.returns ? (
              <KpiCard
                size="compact"
                icon={Undo2}
                tone="warning"
                label={t("agentPortal.dashboard.kpi.returns")}
                value={money(data.returns.merchandiseReturned)}
              />
            ) : null}
            {data.collections ? (
              <KpiCard
                size="compact"
                icon={Clock}
                tone="warning"
                label={t("agentPortal.dashboard.kpi.pendingCollections")}
                value={money(data.collections.awaitingVerificationAmount)}
                description={t("agentPortal.dashboard.kpi.pendingCollectionsCount", {
                  count: data.collections.awaitingVerificationCount,
                })}
              />
            ) : null}
            {data.position ? (
              <>
                <KpiCard
                  size="compact"
                  icon={Hourglass}
                  tone="muted"
                  label={t("agentPortal.dashboard.kpi.pending")}
                  value={money(data.position.pending)}
                />
                <KpiCard
                  size="compact"
                  icon={Wallet}
                  tone="success"
                  label={t("agentPortal.dashboard.kpi.available")}
                  value={money(data.position.available)}
                  description={
                    <>
                      {t("agentPortal.dashboard.kpi.balance")}: {money(data.position.balance)}
                    </>
                  }
                  href={hasPermission("agent.statement.view") ? "/agent/statement" : undefined}
                />
              </>
            ) : null}
            {data.payouts ? (
              <KpiCard
                size="compact"
                icon={HandCoins}
                tone="info"
                label={t("agentPortal.dashboard.kpi.payouts")}
                value={money(data.payouts.total)}
                description={t("agentPortal.dashboard.kpi.payoutsCount", {
                  count: data.payouts.count,
                })}
                href={hasPermission("agent.payouts.view") ? "/agent/payouts" : undefined}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {canViewOrders ? (
        <DetailSection
          title={t("agentPortal.dashboard.recentOrders")}
          actions={
            <Link href="/agent/orders" className="text-caption text-primary hover:underline">
              {t("agentPortal.common.viewAll")}
            </Link>
          }
        >
          {recent && recent.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              {t("agentPortal.dashboard.noOrders")}
            </p>
          ) : (
            <CompactDetailTable
              columns={recentColumns}
              rows={recent ?? []}
              rowKey={(row) => row.id}
            />
          )}
        </DetailSection>
      ) : null}
    </PageWorkspace>
  );
}
