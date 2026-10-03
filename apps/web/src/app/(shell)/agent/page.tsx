"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
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
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { ErrorState } from "@/components/shared/error-state";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import {
  InsightBar,
  InsightCard,
  InsightGroup,
  InsightScope,
  type InsightTone,
} from "@/components/shared/insight-card";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { DashboardPanel, PanelLink, PanelSkeleton } from "@/components/dashboard/dashboard-panel";
import { Skeleton } from "@/components/ui/skeleton";
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
import { cn } from "@/lib/utils";

const STAGE_META: Record<string, { icon: LucideIcon; tone: InsightTone }> = {
  awaitingDispatch: { icon: Hourglass, tone: "warning" },
  dispatched: { icon: Truck, tone: "info" },
  completed: { icon: CheckCircle2, tone: "success" },
  withReturns: { icon: RotateCcw, tone: "destructive" },
  cancelled: { icon: Ban, tone: "neutral" },
};

/** Figures of one panel on the panel's soft surface, split by hairlines. */
const GROUP = "rounded-none border-0";
const TILE = "px-4 py-3";
const ORDER_GRID = "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6";
/** Groups whose tile count leaves a gap: the last tile takes the rest of its row. */
const FILL_LAST_2 = "sm:[&>*:last-child:nth-child(odd)]:col-span-2";
const FILL_LAST_3 =
  "sm:max-lg:[&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(3n+1)]:col-span-3 lg:[&>*:last-child:nth-child(3n+2)]:col-span-2";

/** Lead counts from the scoped leads list (its `total`) — no new endpoint. */
interface LeadCounts {
  all: number;
  fresh: number;
  converted: number;
}

async function loadLeadCounts(): Promise<LeadCounts> {
  const count = (statusCode?: string) =>
    agentPortalService.leads.list({ statusCode, page: 1, pageSize: 1 }).then((page) => page.total);
  const [all, fresh, converted] = await Promise.all([count(), count("NEW"), count("CONVERTED")]);
  return { all, fresh, converted };
}

function GroupSkeleton({ tiles, className }: { tiles: number; className: string }) {
  return (
    <InsightGroup className={cn(GROUP, className)} aria-hidden>
      {Array.from({ length: tiles }, (_, index) => (
        <div key={index} data-slot="insight-card" className={cn("flex flex-col gap-2", TILE)}>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-14" />
        </div>
      ))}
    </InsightGroup>
  );
}

interface TileProps {
  id: string;
  icon: LucideIcon;
  tone?: InsightTone;
  label: string;
  value: ReactNode;
  context?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}

/**
 * Agent dashboard (spec §10; Round 6 design-system §12.13): the same
 * `DashboardPanel` / `InsightGroup` / `InsightCard` family as the company
 * dashboard, fed only by the scoped `GET /agent-portal/dashboard` (plus the
 * scoped leads list for lead counts). Money blocks render only when the API
 * returns them (`agent.statement.view`) — a null block is hidden, never shown
 * as zero — so Agent Sales sees its own orders, fulfillment and leads only.
 */
export default function AgentDashboardPage() {
  const { t, direction } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();
  const canViewOrders = hasPermission("agent.orders.view");
  const canViewLeads = hasPermission("agent.leads.view");
  const [data, setData] = useState<PortalDashboard | null>(null);
  const [recent, setRecent] = useState<PortalOrderRow[] | null>(null);
  const [leads, setLeads] = useState<LeadCounts | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    if (canViewOrders) {
      agentPortalService.orders
        .list({ page: 1, pageSize: 5 })
        .then((page) => setRecent(page.items))
        .catch(() => setRecent([]));
    }
    if (canViewLeads) {
      // A failed count hides the leads panel; it never shows zeros.
      loadLeadCounts()
        .then(setLeads)
        .catch(() => setLeads(null));
    }
    try {
      setData(await agentPortalService.dashboard());
    } catch (err) {
      setError(apiErrorMessage(err, "agentPortal.common.loadFailed"));
    }
  }, [canViewOrders, canViewLeads]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const currency = data?.agent.currency ?? null;
  const money = (value: number) => (
    <MoneyValue value={value} currency={currency} className="font-semibold" />
  );
  const tile = ({ id, ...props }: TileProps) => (
    <InsightCard key={id} direction={direction} className={TILE} {...props} />
  );

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

  const toDate = { kind: "toDate" as const, label: t("insights.scope.toDate") };
  const now = { kind: "current" as const, label: t("insights.scope.current") };
  const hasSales = Boolean(data && (data.sales || data.returns || data.collections));
  const hasPosition = Boolean(data && (data.position || data.payouts));
  const statementLink = hasPermission("agent.statement.view") && Boolean(data?.position);
  const payoutsLink = hasPermission("agent.payouts.view") && Boolean(data?.payouts);

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
      <div className="flex min-w-0 flex-col gap-4">
        <DashboardPanel
          id="agent-orders"
          icon={Package}
          tone="info"
          title={t("insights.agent.ordersTitle")}
          scope={toDate}
          description={
            data
              ? t(data.scope === "OWN" ? "insights.agent.ordersOwn" : "insights.agent.ordersAll")
              : undefined
          }
          busy={!data}
          action={
            canViewOrders ? (
              <PanelLink href="/agent/orders">{t("insights.agent.viewOrders")}</PanelLink>
            ) : undefined
          }
        >
          {data ? (
            <InsightGroup className={cn(GROUP, ORDER_GRID)}>
              {tile({
                id: "total",
                icon: Package,
                tone: "info",
                label: t("agentPortal.dashboard.stages.total"),
                value: data.fulfillment.total,
              })}
              {stageShares(data.fulfillment).map((stage) => {
                const label = t(`agentPortal.dashboard.stages.${stage.key}`);
                return tile({
                  id: stage.key,
                  icon: STAGE_META[stage.key]?.icon ?? Package,
                  tone: STAGE_META[stage.key]?.tone ?? "neutral",
                  label,
                  value: stage.count,
                  context: t("insights.agent.stageShare", { percent: stage.percent }),
                  children: (
                    <InsightBar value={stage.percent} label={`${label} ${stage.percent}%`} />
                  ),
                });
              })}
            </InsightGroup>
          ) : (
            <GroupSkeleton tiles={6} className={ORDER_GRID} />
          )}
        </DashboardPanel>

        {canViewLeads && leads ? (
          <DashboardPanel
            id="agent-leads"
            icon={Users}
            tone="info"
            title={t("insights.agent.leadsTitle")}
            scope={now}
            action={<PanelLink href="/agent/leads">{t("insights.agent.viewLeads")}</PanelLink>}
          >
            <InsightGroup className={cn(GROUP, "grid-cols-3")}>
              {tile({
                id: "all",
                icon: Users,
                tone: "info",
                label: t("insights.agent.leadsAll"),
                value: leads.all,
              })}
              {tile({
                id: "new",
                icon: UserPlus,
                tone: "warning",
                label: t("insights.agent.leadsNew"),
                value: leads.fresh,
                context: t("insights.agent.leadsNewContext"),
              })}
              {tile({
                id: "converted",
                icon: UserCheck,
                tone: "success",
                label: t("insights.agent.leadsConverted"),
                value: leads.converted,
                context: t("insights.agent.leadsConvertedContext"),
              })}
            </InsightGroup>
          </DashboardPanel>
        ) : null}

        {data && (hasSales || hasPosition) ? (
          <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            {hasSales ? (
              <DashboardPanel
                id="agent-sales"
                icon={Banknote}
                tone="success"
                title={t("insights.agent.salesTitle")}
                scope={toDate}
              >
                <InsightGroup
                  className={cn(GROUP, "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3", FILL_LAST_3)}
                >
                  {data.sales
                    ? [
                        tile({
                          id: "salesEx",
                          icon: ShoppingCart,
                          label: t("agentPortal.dashboard.kpi.salesExShipping"),
                          value: money(data.sales.merchandiseSalesExShipping),
                        }),
                        tile({
                          id: "shipping",
                          icon: Truck,
                          label: t("agentPortal.dashboard.kpi.shippingCharges"),
                          value: money(data.sales.customerShippingCharges),
                        }),
                        tile({
                          id: "orderValue",
                          icon: Banknote,
                          tone: "success",
                          label: t("agentPortal.dashboard.kpi.totalOrderValue"),
                          value: money(data.sales.totalOrderValue),
                        }),
                      ]
                    : null}
                  {data.returns
                    ? tile({
                        id: "returns",
                        icon: Undo2,
                        tone: "destructive",
                        label: t("agentPortal.dashboard.kpi.returns"),
                        value: money(data.returns.merchandiseReturned),
                      })
                    : null}
                  {data.collections
                    ? tile({
                        id: "collections",
                        icon: Clock,
                        tone: "warning",
                        label: t("agentPortal.dashboard.kpi.pendingCollections"),
                        value: money(data.collections.awaitingVerificationAmount),
                        context: t("insights.agent.collectionsContext", {
                          count: data.collections.awaitingVerificationCount,
                        }),
                        // The only current-state figure in a to-date group.
                        meta: <InsightScope kind="current">{now.label}</InsightScope>,
                      })
                    : null}
                </InsightGroup>
              </DashboardPanel>
            ) : null}
            {hasPosition ? (
              <DashboardPanel
                id="agent-position"
                icon={Wallet}
                tone="success"
                title={t("insights.agent.positionTitle")}
                scope={now}
                action={
                  statementLink || payoutsLink ? (
                    <span className="flex flex-wrap items-center justify-end gap-1">
                      {statementLink ? (
                        <PanelLink href="/agent/statement">
                          {t("insights.agent.openStatement")}
                        </PanelLink>
                      ) : null}
                      {payoutsLink ? (
                        <PanelLink href="/agent/payouts">
                          {t("insights.agent.openPayouts")}
                        </PanelLink>
                      ) : null}
                    </span>
                  ) : undefined
                }
              >
                <InsightGroup className={cn(GROUP, "grid-cols-1 sm:grid-cols-2", FILL_LAST_2)}>
                  {data.position
                    ? [
                        tile({
                          id: "available",
                          icon: Wallet,
                          tone: "success",
                          label: t("agentPortal.dashboard.kpi.available"),
                          value: money(data.position.available),
                          context: (
                            <>
                              {t("agentPortal.dashboard.kpi.balance")}:{" "}
                              <MoneyValue value={data.position.balance} currency={currency} />
                            </>
                          ),
                        }),
                        tile({
                          id: "pending",
                          icon: Hourglass,
                          tone: "warning",
                          label: t("agentPortal.dashboard.kpi.pending"),
                          value: money(data.position.pending),
                        }),
                      ]
                    : null}
                  {data.payouts
                    ? tile({
                        id: "payouts",
                        icon: HandCoins,
                        tone: "info",
                        label: t("agentPortal.dashboard.kpi.payouts"),
                        value: money(data.payouts.total),
                        context: t("agentPortal.dashboard.kpi.payoutsCount", {
                          count: data.payouts.count,
                        }),
                        // A to-date total inside a current-state group.
                        meta: <InsightScope kind="toDate">{toDate.label}</InsightScope>,
                      })
                    : null}
                </InsightGroup>
              </DashboardPanel>
            ) : null}
          </div>
        ) : null}

        {canViewOrders ? (
          <DashboardPanel
            id="agent-recent"
            icon={ShoppingCart}
            title={t("agentPortal.dashboard.recentOrders")}
            busy={recent === null}
            action={<PanelLink href="/agent/orders">{t("agentPortal.common.viewAll")}</PanelLink>}
          >
            {recent === null ? (
              <PanelSkeleton rows={3} />
            ) : recent.length === 0 ? (
              <p className="px-4 py-3 text-caption text-muted-foreground">
                {t("agentPortal.dashboard.noOrders")}
              </p>
            ) : (
              <div className="p-2">
                <CompactDetailTable
                  columns={recentColumns}
                  rows={recent}
                  rowKey={(row) => row.id}
                  stacked
                />
              </div>
            )}
          </DashboardPanel>
        ) : null}
      </div>
    </PageWorkspace>
  );
}
