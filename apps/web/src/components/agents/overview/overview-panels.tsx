"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  Ban,
  Banknote,
  CheckCircle2,
  Clock,
  HandCoins,
  Hourglass,
  Package,
  PackageCheck,
  RotateCcw,
  ShoppingCart,
  Truck,
  Undo2,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  InsightBar,
  InsightCard,
  InsightGroup,
  InsightScope,
  type InsightTone,
} from "@/components/shared/insight-card";
import { DashboardPanel, PanelLink, PanelSkeleton } from "@/components/dashboard/dashboard-panel";
import { SummaryCard, type SummaryRow } from "@/components/agents/summary-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { Skeleton } from "@/components/ui/skeleton";
import { stageShares } from "@/config/agent-portal/labels";
import type { PortalFulfillmentCounts } from "@/services/agent-portal-service";
import { formatDate } from "@/lib/date";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";
import type {
  LeadCounts,
  OverviewCollections,
  OverviewSales,
  TeamBreakdownRow,
} from "./overview-api";

/**
 * The ONE agent-overview card set (R15 W1, design-system §12.8 / §12.13 /
 * §12.17 / §12.23): panels built only from DashboardPanel, InsightGroup,
 * InsightCard, InsightBar, SummaryCard and InsightScope. Colour follows
 * meaning — blue activity, green conversion / delivery, amber pending, red
 * returns; static tiles stay flat, only drill-downs (`href`) react. Used by the
 * company Agent → Overview tab, the cross-agent overview on Agents and the
 * agent portal dashboard; each consumer passes only what its caller may see.
 */

/** Figures of one panel on the panel's soft surface. */
const GROUP = "p-3";
const TILE = "px-4 py-3";
/** Groups whose tile count leaves a gap: the last tile takes the rest of its row. */
const FILL_LAST_2 = "sm:[&>*:last-child:nth-child(odd)]:col-span-2";

const STAGE_META: Record<string, { icon: LucideIcon; tone: InsightTone }> = {
  awaitingDispatch: { icon: Hourglass, tone: "warning" },
  dispatched: { icon: Truck, tone: "info" },
  completed: { icon: CheckCircle2, tone: "success" },
  withReturns: { icon: RotateCcw, tone: "destructive" },
  cancelled: { icon: Ban, tone: "neutral" },
};

type Currency = string | { code: string } | null;

function useScopes() {
  const { t } = useLocale();
  return {
    toDate: { kind: "toDate" as const, label: t("insights.scope.toDate") },
    now: { kind: "current" as const, label: t("insights.scope.current") },
  };
}

function Tile(props: {
  icon: LucideIcon;
  tone?: InsightTone;
  label: string;
  value: ReactNode;
  amount?: number;
  context?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  href?: string;
}) {
  const { direction } = useLocale();
  return <InsightCard direction={direction} className={TILE} {...props} />;
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

const money = (value: number, currency: Currency) => (
  <MoneyValue value={value} currency={currency} className="font-semibold" />
);

/** Orders and fulfilment: all orders + one tile per stage with its share. */
export function OrdersOverviewPanel({
  id,
  fulfillment,
  description,
  href,
  action,
  emptyAction,
}: {
  id: string;
  /** null while loading. */
  fulfillment: PortalFulfillmentCounts | null;
  description?: string;
  /** The orders list the figures count (drill-down). */
  href?: string;
  action?: ReactNode;
  emptyAction?: ReactNode;
}) {
  const { t } = useLocale();
  const { toDate } = useScopes();
  const grid = "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6";
  return (
    <DashboardPanel
      id={id}
      icon={Package}
      tone="info"
      title={t("insights.agent.ordersTitle")}
      scope={toDate}
      description={description}
      busy={!fulfillment}
      action={
        action || href ? (
          <span className="flex flex-wrap items-center justify-end gap-1">
            {action}
            {href ? <PanelLink href={href}>{t("insights.agent.viewOrders")}</PanelLink> : null}
          </span>
        ) : undefined
      }
    >
      {fulfillment && fulfillment.total === 0 ? (
        <EmptyState
          icon={Package}
          title={t("agentPortal.dashboard.noOrders")}
          className="py-6"
          action={emptyAction}
        />
      ) : fulfillment ? (
        <InsightGroup className={cn(GROUP, grid)}>
          <Tile
            icon={Package}
            tone="info"
            label={t("agentPortal.dashboard.stages.total")}
            value={fulfillment.total}
            href={href}
          />
          {stageShares(fulfillment).map((stage) => {
            const label = t(`agentPortal.dashboard.stages.${stage.key}`);
            return (
              <Tile
                key={stage.key}
                icon={STAGE_META[stage.key]?.icon ?? Package}
                tone={STAGE_META[stage.key]?.tone ?? "neutral"}
                label={label}
                value={stage.count}
                context={t("insights.agent.stageShare", { percent: stage.percent })}
              >
                <InsightBar value={stage.percent} label={`${label} ${stage.percent}%`} />
              </Tile>
            );
          })}
        </InsightGroup>
      ) : (
        <GroupSkeleton tiles={6} className={grid} />
      )}
    </DashboardPanel>
  );
}

/** Leads now: all / new / converted. */
export function LeadsOverviewPanel({
  id,
  leads,
  href,
}: {
  id: string;
  leads: LeadCounts;
  href?: string;
}) {
  const { t } = useLocale();
  const { now } = useScopes();
  return (
    <DashboardPanel
      id={id}
      icon={Users}
      tone="info"
      title={t("insights.agent.leadsTitle")}
      scope={now}
      action={href ? <PanelLink href={href}>{t("insights.agent.viewLeads")}</PanelLink> : undefined}
    >
      <InsightGroup className={cn(GROUP, "grid-cols-1 sm:grid-cols-3")}>
        <Tile
          icon={Users}
          tone="info"
          label={t("insights.agent.leadsAll")}
          value={leads.total}
          href={href}
        />
        <Tile
          icon={UserPlus}
          tone="warning"
          label={t("insights.agent.leadsNew")}
          value={leads.fresh}
          context={t("insights.agent.leadsNewContext")}
        />
        <Tile
          icon={UserCheck}
          tone="success"
          label={t("insights.agent.leadsConverted")}
          value={leads.converted}
          context={t("insights.agent.leadsConvertedContext")}
        />
      </InsightGroup>
    </DashboardPanel>
  );
}

/**
 * Sales and collections to date. Every block is optional — a block the caller
 * may not see is simply not passed (never drawn as zero).
 */
export function SalesOverviewPanel({
  id,
  currency,
  title,
  sales,
  own,
  delivered,
  returns,
  returnCount,
  collections,
}: {
  id: string;
  currency: Currency;
  title?: string;
  sales?: OverviewSales | null;
  /** An employee's own figures (portal OWN scope). */
  own?: { orderValue: number } | null;
  delivered?: { count: number; value: number } | null;
  returns?: { merchandiseReturned: number } | null;
  returnCount?: number | null;
  collections?: OverviewCollections | null;
}) {
  const { t } = useLocale();
  const { toDate, now } = useScopes();
  const tiles: ReactNode[] = [];
  if (sales) {
    tiles.push(
      <Tile
        key="salesEx"
        icon={ShoppingCart}
        label={t("agentPortal.dashboard.kpi.salesExShipping")}
        value={money(sales.merchandiseSalesExShipping, currency)}
        amount={sales.merchandiseSalesExShipping}
      />,
      <Tile
        key="shipping"
        icon={Truck}
        label={t("agentPortal.dashboard.kpi.shippingCharges")}
        value={money(sales.customerShippingCharges, currency)}
        amount={sales.customerShippingCharges}
      />,
    );
  }
  const orderValue = sales?.totalOrderValue ?? own?.orderValue;
  if (orderValue !== undefined) {
    tiles.push(
      <Tile
        key="orderValue"
        icon={Banknote}
        tone="success"
        label={t("agentPortal.dashboard.kpi.totalOrderValue")}
        value={money(orderValue, currency)}
        amount={orderValue}
      />,
    );
  }
  if (delivered) {
    tiles.push(
      <Tile
        key="delivered"
        icon={PackageCheck}
        tone="success"
        label={t("agentOverview.delivered")}
        value={money(delivered.value, currency)}
        amount={delivered.value}
        context={t("agentOverview.deliveredContext", { count: delivered.count })}
      />,
    );
  }
  if (returns) {
    tiles.push(
      <Tile
        key="returns"
        icon={Undo2}
        tone="destructive"
        label={t("agentPortal.dashboard.kpi.returns")}
        value={money(returns.merchandiseReturned, currency)}
        amount={returns.merchandiseReturned}
      />,
    );
  } else if (returnCount !== undefined && returnCount !== null) {
    tiles.push(
      <Tile
        key="returnCount"
        icon={Undo2}
        tone="destructive"
        label={t("agentOverview.returnCount")}
        value={returnCount}
      />,
    );
  }
  if (collections) {
    tiles.push(
      <Tile
        key="collections"
        icon={Clock}
        tone="warning"
        label={t("agentPortal.dashboard.kpi.pendingCollections")}
        value={money(collections.awaitingVerificationAmount, currency)}
        amount={collections.awaitingVerificationAmount}
        context={t("insights.agent.collectionsContext", {
          count: collections.awaitingVerificationCount,
        })}
        // The only current-state figure in a to-date group.
        meta={<InsightScope kind="current">{now.label}</InsightScope>}
      />,
    );
  }
  if (tiles.length === 0) return null;
  return (
    <DashboardPanel
      id={id}
      icon={Banknote}
      tone="success"
      title={title ?? t("insights.agent.salesTitle")}
      scope={toDate}
    >
      <InsightGroup className={cn(GROUP, "grid-cols-1 sm:grid-cols-2", FILL_LAST_2)}>
        {tiles}
      </InsightGroup>
    </DashboardPanel>
  );
}

/** Statement position now (+ payouts to date). Agent-level money only. */
export function PositionOverviewPanel({
  id,
  currency,
  position,
  payouts,
  statementHref,
  payoutsHref,
}: {
  id: string;
  currency: Currency;
  position?: { balance: number; pending: number; available: number } | null;
  payouts?: { count: number; total: number } | null;
  statementHref?: string;
  payoutsHref?: string;
}) {
  const { t } = useLocale();
  const { toDate, now } = useScopes();
  if (!position && !payouts) return null;
  return (
    <DashboardPanel
      id={id}
      icon={Wallet}
      tone="success"
      title={t("insights.agent.positionTitle")}
      scope={now}
      action={
        statementHref || payoutsHref ? (
          <span className="flex flex-wrap items-center justify-end gap-1">
            {statementHref ? (
              <PanelLink href={statementHref}>{t("insights.agent.openStatement")}</PanelLink>
            ) : null}
            {payoutsHref ? (
              <PanelLink href={payoutsHref}>{t("insights.agent.openPayouts")}</PanelLink>
            ) : null}
          </span>
        ) : undefined
      }
    >
      <InsightGroup className={cn(GROUP, "grid-cols-1 sm:grid-cols-2", FILL_LAST_2)}>
        {position ? (
          <>
            <Tile
              icon={Wallet}
              tone="success"
              label={t("agentPortal.dashboard.kpi.available")}
              value={money(position.available, currency)}
              amount={position.available}
              href={statementHref}
              context={
                <>
                  {t("agentPortal.dashboard.kpi.balance")}:{" "}
                  <MoneyValue value={position.balance} currency={currency} />
                </>
              }
            />
            <Tile
              icon={Hourglass}
              tone="warning"
              label={t("agentPortal.dashboard.kpi.pending")}
              value={money(position.pending, currency)}
              amount={position.pending}
            />
          </>
        ) : null}
        {payouts ? (
          <Tile
            icon={HandCoins}
            tone="info"
            label={t("agentPortal.dashboard.kpi.payouts")}
            value={money(payouts.total, currency)}
            amount={payouts.total}
            href={payoutsHref}
            context={t("agentPortal.dashboard.kpi.payoutsCount", { count: payouts.count })}
            // A to-date total inside a current-state group.
            meta={<InsightScope kind="toDate">{toDate.label}</InsightScope>}
          />
        ) : null}
      </InsightGroup>
    </DashboardPanel>
  );
}

export interface BreakdownCard {
  key: string;
  title: string;
  currency: string;
  rows: SummaryRow[];
  tone?: InsightTone;
}

/** One summary card per member (team) or per agent (cross-agent) — container-fit columns, one on phones. */
export function BreakdownCards({ cards }: { cards: readonly BreakdownCard[] }) {
  return (
    <InsightGroup fit className={GROUP}>
      {cards.map((card) => (
        <SummaryCard
          key={card.key}
          title={card.title}
          rows={card.rows}
          currency={card.currency}
          tone={card.tone}
          icon={Users}
        />
      ))}
    </InsightGroup>
  );
}

/** Count rows of a breakdown card (counts are text, never money). */
export function countRows(
  t: ReturnType<typeof useLocale>["t"],
  /** `leads` is absent for a viewer without lead visibility (R15 review L4). */
  figures: { fulfillment: PortalFulfillmentCounts; returnCount: number; leads?: LeadCounts },
): SummaryRow[] {
  return [
    { label: t("agentPortal.dashboard.stages.total"), value: String(figures.fulfillment.total) },
    {
      label: t("agentPortal.dashboard.stages.awaitingDispatch"),
      value: String(figures.fulfillment.awaitingDispatch),
    },
    {
      label: t("agentPortal.dashboard.stages.dispatched"),
      value: String(figures.fulfillment.dispatched),
    },
    {
      label: t("agentPortal.dashboard.stages.completed"),
      value: String(figures.fulfillment.completed),
    },
    { label: t("agentOverview.returnCount"), value: String(figures.returnCount) },
    ...(figures.leads
      ? [
          {
            label: t("agentOverview.leads"),
            value: t("agentOverview.leadsValue", {
              total: figures.leads.total,
              converted: figures.leads.converted,
            }),
          },
        ]
      : []),
  ];
}

/** Per-employee breakdown of one agent (team view). */
export function TeamOverviewPanel({
  id,
  rows,
  currency,
}: {
  id: string;
  rows: readonly TeamBreakdownRow[];
  currency: string;
}) {
  const { t } = useLocale();
  const { toDate } = useScopes();
  if (rows.length === 0) return null;
  return (
    <DashboardPanel
      id={id}
      icon={Users}
      tone="info"
      title={t("agentOverview.team.title")}
      description={t("agentOverview.team.description")}
      scope={toDate}
    >
      <BreakdownCards
        cards={rows.map((row) => ({
          key: row.user?.id ?? "unassigned",
          title: row.user
            ? row.user.isActive
              ? row.user.fullName
              : `${row.user.fullName} · ${t("agentOverview.team.inactive")}`
            : t("agentOverview.team.unassigned"),
          currency,
          tone: row.sales && row.sales.orderValue > 0 ? "success" : "neutral",
          rows: [
            ...countRows(t, row),
            ...(row.sales
              ? [
                  {
                    label: t("agentPortal.dashboard.kpi.totalOrderValue"),
                    value: row.sales.orderValue,
                  },
                  {
                    label: t("agentOverview.delivered"),
                    value: row.sales.deliveredValue,
                    emphasis: true,
                  },
                ]
              : []),
          ],
        }))}
      />
    </DashboardPanel>
  );
}

export interface RecentOrderRow {
  id: string;
  number: string;
  date: string;
  customer: string | null;
  total: number | string | null;
  currency: Currency;
  href: string;
  status?: ReactNode;
}

/** The latest orders (a compact table, stacked on phones). */
export function RecentOrdersPanel({
  id,
  rows,
  failed,
  onRetry,
  href,
  emptyAction,
}: {
  id: string;
  /** null while loading. */
  rows: RecentOrderRow[] | null;
  failed: boolean;
  onRetry: () => void;
  href?: string;
  emptyAction?: ReactNode;
}) {
  const { t } = useLocale();
  const columns: CompactDetailColumn<RecentOrderRow>[] = [
    {
      id: "number",
      header: t("agentPortal.orders.fields.number"),
      cell: (row) => (
        <StackedCell
          primary={
            <Link href={row.href} className="hover:underline">
              <SemanticValue kind="id">{row.number}</SemanticValue>
            </Link>
          }
          secondary={<span className="num">{formatDate(row.date)}</span>}
        />
      ),
    },
    {
      id: "customer",
      header: t("agentPortal.orders.fields.customer"),
      cell: (row) => row.customer ?? "—",
    },
    {
      id: "payable",
      header: t("agentPortal.orders.fields.payable"),
      align: "end",
      cell: (row) =>
        row.total == null ? "—" : <MoneyValue value={row.total} currency={row.currency} />,
    },
    {
      id: "status",
      header: t("agentPortal.orders.fields.fulfillment"),
      cell: (row) => row.status ?? "—",
    },
  ];
  return (
    <DashboardPanel
      id={id}
      icon={ShoppingCart}
      title={t("agentPortal.dashboard.recentOrders")}
      busy={rows === null && !failed}
      action={
        href ? <PanelLink href={href}>{t("agentPortal.common.viewAll")}</PanelLink> : undefined
      }
    >
      {failed ? (
        <ErrorState description={t("agentPortal.dashboard.recentFailed")} onRetry={onRetry} />
      ) : rows === null ? (
        <PanelSkeleton rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title={t("agentPortal.dashboard.noOrders")}
          className="py-6"
          action={emptyAction}
        />
      ) : (
        <div className="p-2">
          <CompactDetailTable columns={columns} rows={rows} rowKey={(row) => row.id} stacked />
        </div>
      )}
    </DashboardPanel>
  );
}
