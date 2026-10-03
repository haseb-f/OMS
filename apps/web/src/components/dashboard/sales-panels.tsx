"use client";

import {
  ArrowRightLeft,
  ChartNoAxesColumn,
  Clock,
  PackageCheck,
  Percent,
  ShoppingBag,
  Trophy,
  TrendingUp,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import {
  InsightBar,
  InsightCard,
  InsightGroup,
  InsightScope,
  type InsightTone,
} from "@/components/shared/insight-card";
import { EmptyState } from "@/components/shared/empty-state";
import { EnterpriseBadge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DashboardPanel, PanelLink, ShareBar } from "@/components/dashboard/dashboard-panel";
import {
  SALES_PERIODS,
  buildActivityRows,
  percentOf,
  type ActivityKey,
  type SalesByPeriod,
} from "@/components/dashboard/dashboard-data";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import type { SalesPerformanceDashboard, SalesPeriod } from "@/services/sales-performance-service";
import { cn } from "@/lib/utils";

export const PERIOD_LABEL_KEY: Record<SalesPeriod, MessageKey> = {
  today: "crm.leads.dashboard.today",
  week: "crm.leads.dashboard.week",
  month: "crm.leads.dashboard.month",
};

/** Six figures in one hairline-split cluster: 3 × 2 on desktop, 2 × 3 on phones. */
const CLUSTER = "rounded-none border-0 grid-cols-2 sm:grid-cols-3";

interface Figure {
  key: string;
  label: MessageKey;
  value: string;
  /** Only when it adds meaning — the scope is stated by the panel. */
  context?: string;
  icon: LucideIcon;
  tone: InsightTone;
  bar?: number;
  /** A current-state figure inside a period group — labelled «الآن» on the tile. */
  current?: boolean;
}

/**
 * Sales performance for the selected period: the lead funnel on the first
 * row, orders and the live pipeline on the second — label → figure → one
 * line saying what the figure counts.
 */
export function SalesOverviewPanel({
  data,
  period,
  leadsHref,
}: {
  data: SalesPerformanceDashboard | null;
  period: SalesPeriod;
  /** The leads list, when the user may open it. */
  leadsHref?: string;
}) {
  const { t } = useLocale();
  const periodLabel = t(PERIOD_LABEL_KEY[period]);
  const kpis = data?.kpis;
  const figures: Figure[] = kpis
    ? [
        {
          key: "newLeads",
          label: "crm.leads.dashboard.newLeads",
          value: String(kpis.newLeads),
          context: t("insights.company.newLeads"),
          icon: UserPlus,
          tone: "info",
        },
        {
          key: "converted",
          label: "crm.leads.dashboard.converted",
          value: String(kpis.converted),
          context: t("insights.company.converted"),
          icon: ArrowRightLeft,
          tone: "success",
        },
        {
          key: "conversionRate",
          label: "crm.leads.dashboard.conversionRate",
          value: `${kpis.conversionRate}%`,
          context: t("insights.company.conversion"),
          icon: Percent,
          tone: "success",
          bar: kpis.conversionRate,
        },
        {
          key: "orders",
          label: "docUi.dashboard.ordersInScope",
          value: String(kpis.orders),
          icon: ShoppingBag,
          tone: "info",
        },
        {
          key: "delivered",
          label: "crm.leads.dashboard.delivered",
          value: String(kpis.delivered),
          context: t("insights.company.delivered"),
          icon: PackageCheck,
          tone: "success",
        },
        {
          key: "inProgress",
          label: "crm.leads.dashboard.inProgress",
          value: String(kpis.inProgress),
          context: t("insights.company.inProgress"),
          icon: Clock,
          tone: "warning",
          current: true,
        },
      ]
    : [];

  return (
    <DashboardPanel
      id="dash-sales"
      icon={TrendingUp}
      tone="info"
      title={t("docUi.dashboard.salesTitle")}
      scope={{ kind: "period", label: periodLabel }}
      description={t("insights.company.salesScope")}
      busy={!data}
      action={
        leadsHref ? (
          <PanelLink href={leadsHref}>{t("dashboard.overview.viewAll")}</PanelLink>
        ) : undefined
      }
    >
      <InsightGroup className={CLUSTER}>
        {data
          ? figures.map((figure) => (
              <InsightCard
                key={figure.key}
                icon={figure.icon}
                tone={figure.tone}
                label={t(figure.label)}
                value={figure.value}
                context={figure.context}
                meta={
                  figure.current ? (
                    <InsightScope kind="current">{t("insights.scope.current")}</InsightScope>
                  ) : undefined
                }
                className="px-4 py-3"
              >
                {figure.bar !== undefined ? (
                  <InsightBar value={figure.bar} label={`${t(figure.label)} ${figure.value}`} />
                ) : null}
              </InsightCard>
            ))
          : Array.from({ length: 6 }, (_, index) => (
              <div key={index} data-slot="insight-card" className="flex flex-col gap-2 px-4 py-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-6 w-14" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
      </InsightGroup>
    </DashboardPanel>
  );
}

const ACTIVITY_LABEL: Record<ActivityKey, MessageKey> = {
  newLeads: "crm.leads.dashboard.newLeads",
  converted: "crm.leads.dashboard.converted",
  orders: "docUi.dashboard.ordersInScope",
  delivered: "crm.leads.dashboard.delivered",
};

/**
 * The pace of work: each measure today, this week and this month to date,
 * with bars on one scale per row so the three periods compare at a glance.
 * Independent of the period switch.
 */
export function ActivityPanel({ data }: { data: SalesByPeriod | null }) {
  const { t } = useLocale();
  const rows = data ? buildActivityRows(data) : [];

  return (
    <DashboardPanel
      id="dash-activity"
      icon={ChartNoAxesColumn}
      tone="info"
      scope={{ kind: "toDate", label: t("insights.scope.pace") }}
      title={t("dashboard.overview.activityTitle")}
      description={t("insights.company.salesScope")}
      busy={!data}
    >
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[34%]">{t("dashboard.overview.measureColumn")}</TableHead>
            {SALES_PERIODS.map((period) => (
              <TableHead key={period}>{t(PERIOD_LABEL_KEY[period])}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data
            ? rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="truncate font-medium">
                    {t(ACTIVITY_LABEL[row.key])}
                  </TableCell>
                  {SALES_PERIODS.map((period) => (
                    <TableCell key={period}>
                      <div className="flex flex-col gap-1.5">
                        <span className="num font-semibold">{row.values[period]}</span>
                        <ShareBar
                          value={row.bars[period]}
                          label={`${t(ACTIVITY_LABEL[row.key])} · ${t(PERIOD_LABEL_KEY[period])}: ${row.values[period]}`}
                        />
                      </div>
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : Array.from({ length: 4 }, (_, index) => (
                <TableRow key={index}>
                  {Array.from({ length: 4 }, (_, cell) => (
                    <TableCell key={cell}>
                      <Skeleton className="h-4 w-3/4" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </DashboardPanel>
  );
}

/**
 * Orders created per salesperson in the selected period: the top eight with
 * a bar on one scale, the signed-in user highlighted. Hidden for users who
 * only see their own orders (the API returns no leaderboard for them).
 */
export function RankingPanel({
  data,
  period,
}: {
  data: SalesPerformanceDashboard;
  period: SalesPeriod;
}) {
  const { t } = useLocale();
  const { self, leaderboard } = data.ranking;
  const rows = leaderboard.slice(0, 8);
  const top = rows[0]?.orders ?? 0;
  const ranked = leaderboard.some((row) => row.rank === self.rank && self.orders > 0);

  return (
    <DashboardPanel
      id="dash-ranking"
      icon={Trophy}
      tone="success"
      title={t("crm.leads.dashboard.ranking")}
      scope={{ kind: "period", label: t(PERIOD_LABEL_KEY[period]) }}
      description={t("insights.company.ranking")}
    >
      {rows.length === 0 ? (
        <EmptyState icon={Trophy} title={t("dashboard.overview.rankingEmpty")} className="py-6" />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-sunken px-3 py-2 text-caption">
            <span className="text-muted-foreground">{t("dashboard.overview.yourRank")}</span>
            <span className="num">
              {/* Not on the board (no orders yet): no invented rank, just the count. */}
              {ranked ? (
                <span className="font-semibold text-foreground">
                  {t("docUi.dashboard.rank", { rank: self.rank, of: self.of })}
                  {" · "}
                </span>
              ) : null}
              <span className="text-muted-foreground">
                {t("docUi.dashboard.ordersCount", { count: self.orders })}
              </span>
            </span>
          </div>
          <ol className="divide-y divide-border">
            {rows.map((row) => {
              const isSelf = ranked && row.rank === self.rank;
              return (
                <li
                  key={`${row.rank}-${row.userId}`}
                  aria-current={isSelf ? "true" : undefined}
                  className={cn(
                    "grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 px-3 py-1.5",
                    isSelf && "bg-table-row-selected",
                  )}
                >
                  <span className="num text-caption text-muted-foreground">#{row.rank}</span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-body font-medium">{row.displayName}</span>
                    {isSelf ? (
                      <EnterpriseBadge variant="info">{t("docUi.dashboard.you")}</EnterpriseBadge>
                    ) : null}
                  </span>
                  <span className="num text-end text-body font-semibold">{row.orders}</span>
                  <span className="col-start-2 col-end-4">
                    <ShareBar
                      value={percentOf(row.orders, top)}
                      label={t("docUi.dashboard.ordersCount", { count: row.orders })}
                    />
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </DashboardPanel>
  );
}
