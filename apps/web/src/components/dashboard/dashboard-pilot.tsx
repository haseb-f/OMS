"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import {
  Bell,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  Landmark,
  type LucideIcon,
} from "lucide-react";
import { EnterpriseCard } from "@/components/ui/card";
import { EnterpriseBadge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { SectionHeading } from "@/components/shared/section-heading";
import { ErrorState } from "@/components/shared/error-state";
import { loadPendingFigures, useLoad } from "@/components/dashboard/dashboard-data";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import {
  salesPerformanceService,
  type SalesPeriod,
  type SalesPerformanceDashboard,
} from "@/services/sales-performance-service";

const PERIOD_LABEL_KEY: Record<SalesPeriod, MessageKey> = {
  today: "crm.leads.dashboard.today",
  week: "crm.leads.dashboard.week",
  month: "crm.leads.dashboard.month",
};

type Severity = "destructive" | "warning";

interface AttentionItem {
  key: string;
  icon: LucideIcon;
  title: string;
  hint: string;
  count: number;
  severity: Severity;
  href: string;
}

/**
 * Round 3 pilot dashboard (design-system §12.6): 1) needs attention — the
 * open work queues as one entity list, most urgent first; 2) the sales
 * metrics for the selected period; 3) operational detail (ranking). Every
 * figure comes from the same endpoints as the classic dashboard.
 */
export function DashboardPilot({
  showSales,
  showPaymentReview,
  showBank,
  period,
  onPeriodChange,
  emptyState,
}: {
  showSales: boolean;
  showPaymentReview: boolean;
  showBank: boolean;
  period: SalesPeriod;
  onPeriodChange: (period: SalesPeriod) => void;
  emptyState: ReactNode;
}) {
  const { t } = useLocale();
  const salesLoader = useMemo(
    () => () => (showSales ? salesPerformanceService.dashboard(period) : Promise.resolve(null)),
    [showSales, period],
  );
  const pendingLoader = useMemo(
    () => () => loadPendingFigures(showPaymentReview, showBank),
    [showPaymentReview, showBank],
  );
  const sales = useLoad(salesLoader);
  const pending = useLoad(pendingLoader);
  const showAttention = showSales || showPaymentReview || showBank;

  return (
    <PageWorkspace title={t("dashboard.welcomeTitle")} description={t("dashboard.welcomeSubtitle")}>
      {/* Reading order = priority: needs attention → metrics → details. On wide
          screens the metrics and the ranking share the second row. */}
      <div className="flex flex-col gap-6">
        {showAttention ? (
          <AttentionSection sales={sales} pending={pending} showSales={showSales} />
        ) : null}
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          {showSales ? (
            <section aria-labelledby="dash-metrics" className="flex min-w-0 flex-col gap-3">
              <SectionHeading
                id="dash-metrics"
                title={t("docUi.dashboard.metricsTitle")}
                description={t("docUi.dashboard.metricsDescription")}
                action={
                  <ToggleGroup
                    type="single"
                    value={period}
                    aria-label={t("docUi.dashboard.period")}
                    onValueChange={(value) => {
                      if (value) onPeriodChange(value as SalesPeriod);
                    }}
                  >
                    {(["today", "week", "month"] as const).map((item) => (
                      <ToggleGroupItem key={item} value={item} size="default">
                        {t(PERIOD_LABEL_KEY[item])}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                }
              />
              {sales.state.status === "error" ? (
                <ErrorState
                  description={t("docUi.dashboard.loadFailed")}
                  onRetry={() => void sales.retry()}
                />
              ) : (
                <MetricsStrip
                  data={sales.state.status === "ready" ? sales.state.data : null}
                  loading={sales.state.status === "loading"}
                />
              )}
            </section>
          ) : null}
          {showSales && sales.state.status === "ready" && sales.state.data ? (
            <RankingSection data={sales.state.data} />
          ) : null}
        </div>
        {!showAttention ? emptyState : null}
      </div>
    </PageWorkspace>
  );
}

function AttentionSection({
  sales,
  pending,
  showSales,
}: {
  sales: ReturnType<typeof useLoad<SalesPerformanceDashboard | null>>;
  pending: ReturnType<typeof useLoad<Awaited<ReturnType<typeof loadPendingFigures>>>>;
  showSales: boolean;
}) {
  const { t } = useLocale();
  const loading =
    pending.state.status === "loading" || (showSales && sales.state.status === "loading");
  const failed = pending.state.status === "error" || (showSales && sales.state.status === "error");

  const items: AttentionItem[] = [];
  if (sales.state.status === "ready" && sales.state.data) {
    const { overdue, dueToday } = sales.state.data.kpis;
    items.push(
      {
        key: "overdue",
        icon: Bell,
        title: t("crm.leads.dashboard.overdue"),
        hint: t("docUi.dashboard.overdueHint"),
        count: overdue,
        severity: "destructive",
        href: "/crm/leads?followUp=overdue",
      },
      {
        key: "dueToday",
        icon: CalendarClock,
        title: t("crm.leads.dashboard.dueToday"),
        hint: t("docUi.dashboard.dueTodayHint"),
        count: dueToday,
        severity: "warning",
        href: "/crm/leads?followUp=today",
      },
    );
  }
  if (pending.state.status === "ready") {
    const figures = pending.state.data;
    if (figures.paymentReview !== null) {
      items.push({
        key: "paymentReview",
        icon: ClipboardCheck,
        title: t("docUi.dashboard.paymentReview"),
        hint: t("docUi.dashboard.paymentReviewHint"),
        count: figures.paymentReview,
        severity: "warning",
        href: "/finance/payment-review",
      });
    }
    if (figures.bank) {
      items.push(
        {
          key: "bankReview",
          icon: Landmark,
          title: t("docUi.dashboard.bankReview"),
          hint: t("docUi.dashboard.bankReviewHint"),
          count: figures.bank.review,
          severity: "warning",
          href: "/finance/bank-transactions",
        },
        {
          key: "bankUnmatched",
          icon: Landmark,
          title: t("docUi.dashboard.bankUnmatched"),
          hint: t("docUi.dashboard.bankUnmatchedHint"),
          count: figures.bank.unmatched,
          severity: "warning",
          href: "/finance/bank-transactions",
        },
      );
    }
  }
  // Open work first (destructive before warning, then by size); cleared queues last.
  const rank = (item: AttentionItem) =>
    item.count > 0 ? (item.severity === "destructive" ? 0 : 1) : 2;
  items.sort((a, b) => rank(a) - rank(b) || b.count - a.count);
  const openCount = items.filter((item) => item.count > 0).length;

  return (
    <section aria-labelledby="dash-attention" className="flex flex-col gap-3" aria-busy={loading}>
      <SectionHeading
        id="dash-attention"
        title={t("docUi.dashboard.attentionTitle")}
        description={t("docUi.dashboard.attentionDescription")}
        action={
          !loading && !failed ? (
            <EnterpriseBadge variant={openCount > 0 ? "warning" : "success"}>
              {openCount > 0 ? null : <CircleCheck />}
              {openCount > 0
                ? t("docUi.dashboard.openQueues", { count: openCount })
                : t("docUi.dashboard.allClear")}
            </EnterpriseBadge>
          ) : undefined
        }
      />
      {failed ? (
        <ErrorState
          description={t("docUi.dashboard.loadFailed")}
          onRetry={() => {
            void pending.retry();
            if (showSales) void sales.retry();
          }}
        />
      ) : (
        <EnterpriseCard className="gap-0 py-0">
          <ul className="divide-y divide-border">
            {loading
              ? Array.from({ length: 3 }, (_, index) => (
                  <li key={index} className="flex items-center gap-3 px-4 py-3">
                    <Skeleton className="size-8 rounded-sm" />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Skeleton className="h-3.5 w-40" />
                      <Skeleton className="h-3 w-56" />
                    </div>
                    <Skeleton className="h-5 w-8" />
                  </li>
                ))
              : items.map((item) => <AttentionRow key={item.key} item={item} />)}
          </ul>
        </EnterpriseCard>
      )}
    </section>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const { t, direction } = useLocale();
  const Icon = item.icon;
  const open = item.count > 0;
  const Chevron = direction === "rtl" ? ChevronLeft : ChevronRight;
  return (
    <li>
      <Link
        href={item.href}
        className="group/row flex items-center gap-3 px-4 py-3 transition-colors duration-(--duration-base) outline-none hover:bg-table-row-hover focus-visible:bg-table-row-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-sm border",
            open &&
              item.severity === "destructive" &&
              "border-destructive-border bg-destructive-soft text-destructive-soft-foreground",
            open &&
              item.severity === "warning" &&
              "border-warning-border bg-warning-soft text-warning-soft-foreground",
            !open && "border-border bg-card text-muted-foreground",
          )}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate text-body font-medium", !open && "text-muted-foreground")}>
            {item.title}
          </span>
          <span className="truncate text-caption text-muted-foreground">
            {open ? item.hint : t("docUi.dashboard.allClear")}
          </span>
        </span>
        <span
          className={cn(
            "num shrink-0 text-card-title",
            open && item.severity === "destructive" && "text-destructive-soft-foreground",
            open && item.severity === "warning" && "text-foreground",
            !open && "text-muted-foreground",
          )}
        >
          {item.count}
        </span>
        <Chevron
          className="size-4 shrink-0 text-muted-foreground transition-colors group-hover/row:text-foreground"
          aria-hidden
        />
        <span className="sr-only">{t("docUi.dashboard.open")}</span>
      </Link>
    </li>
  );
}

interface Metric {
  key: string;
  labelKey: MessageKey;
  value: string;
  now?: boolean;
}

function MetricsStrip({
  data,
  loading,
}: {
  data: SalesPerformanceDashboard | null;
  loading: boolean;
}) {
  const { t } = useLocale();
  const kpis = data?.kpis;
  const metrics: Metric[] = kpis
    ? [
        { key: "newLeads", labelKey: "crm.leads.dashboard.newLeads", value: String(kpis.newLeads) },
        {
          key: "inProgress",
          labelKey: "crm.leads.dashboard.inProgress",
          value: String(kpis.inProgress),
          now: true,
        },
        {
          key: "converted",
          labelKey: "crm.leads.dashboard.converted",
          value: String(kpis.converted),
        },
        {
          key: "conversionRate",
          labelKey: "crm.leads.dashboard.conversionRate",
          value: `${kpis.conversionRate}%`,
        },
        { key: "orders", labelKey: "docUi.dashboard.ordersInScope", value: String(kpis.orders) },
        {
          key: "delivered",
          labelKey: "crm.leads.dashboard.delivered",
          value: String(kpis.delivered),
        },
      ]
    : [];

  return (
    <EnterpriseCard className="gap-0 py-0">
      {/* Hairline grid: the card's border color shows through a 1px gap. */}
      <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
        {loading || !kpis
          ? Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex flex-col gap-2 bg-card px-4 py-3">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-12" />
              </div>
            ))
          : metrics.map((metric) => (
              <div key={metric.key} className="flex min-w-0 flex-col gap-1 bg-card px-4 py-3">
                <dt className="flex items-center gap-1.5 truncate text-caption text-muted-foreground">
                  {t(metric.labelKey)}
                  {metric.now ? (
                    <span className="text-micro text-placeholder">
                      · {t("docUi.dashboard.now")}
                    </span>
                  ) : null}
                </dt>
                <dd className="num text-metric">{metric.value}</dd>
              </div>
            ))}
      </dl>
    </EnterpriseCard>
  );
}

function RankingSection({ data }: { data: SalesPerformanceDashboard }) {
  const { t } = useLocale();
  const self = data.ranking.self;
  const leaderboard = data.ranking.leaderboard.slice(0, 8);
  if (leaderboard.length === 0) return null;

  return (
    <section aria-labelledby="dash-ranking" className="flex flex-col gap-3">
      <SectionHeading
        id="dash-ranking"
        title={t("crm.leads.dashboard.ranking")}
        description={t("docUi.dashboard.rankingDescription")}
        action={
          <span className="text-caption text-muted-foreground">
            <span className="num font-medium text-foreground">
              {t("docUi.dashboard.rank", { rank: self.rank, of: self.of })}
            </span>
            {" · "}
            <span className="num">{t("docUi.dashboard.ordersCount", { count: self.orders })}</span>
          </span>
        }
      />
      <EnterpriseCard className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">{t("docUi.dashboard.rankColumn")}</TableHead>
              <TableHead>{t("docUi.dashboard.nameColumn")}</TableHead>
              <TableHead className="text-end">{t("docUi.dashboard.ordersColumn")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leaderboard.map((row) => {
              const isSelf = row.rank === self.rank;
              return (
                <TableRow
                  key={`${row.rank}-${row.userId}`}
                  data-state={isSelf ? "selected" : undefined}
                >
                  <TableCell className="num text-muted-foreground">#{row.rank}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{row.displayName}</span>
                      {isSelf ? (
                        <EnterpriseBadge variant="info">{t("docUi.dashboard.you")}</EnterpriseBadge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="num text-end font-medium">{row.orders}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </EnterpriseCard>
    </section>
  );
}
