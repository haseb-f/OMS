"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRightLeft,
  BellRing,
  CalendarClock,
  CircleCheck,
  Clock,
  Landmark,
  PackageCheck,
  Percent,
  ReceiptText,
  Scale,
  ShoppingBag,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { EnterpriseCard } from "@/components/ui/card";
import { InsightBar, InsightCard, type InsightTone } from "@/components/shared/insight-card";
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
  action: string;
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
                  periodLabel={t(PERIOD_LABEL_KEY[period])}
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
  const { t, direction } = useLocale();
  const loading =
    pending.state.status === "loading" || (showSales && sales.state.status === "loading");
  const failed = pending.state.status === "error" || (showSales && sales.state.status === "error");

  const items: AttentionItem[] = [];
  if (sales.state.status === "ready" && sales.state.data) {
    const { overdue, dueToday } = sales.state.data.kpis;
    items.push(
      {
        key: "overdue",
        icon: BellRing,
        title: t("crm.leads.dashboard.overdue"),
        hint: t("docUi.dashboard.overdueHint"),
        action: t("docUi.dashboard.actionOverdue"),
        count: overdue,
        severity: "destructive",
        href: "/crm/leads?followUp=overdue",
      },
      {
        key: "dueToday",
        icon: CalendarClock,
        title: t("crm.leads.dashboard.dueToday"),
        hint: t("docUi.dashboard.dueTodayHint"),
        action: t("docUi.dashboard.actionDueToday"),
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
        icon: ReceiptText,
        title: t("docUi.dashboard.paymentReview"),
        hint: t("docUi.dashboard.paymentReviewHint"),
        action: t("docUi.dashboard.actionPaymentReview"),
        count: figures.paymentReview,
        severity: "warning",
        href: "/finance/payment-review",
      });
    }
    if (figures.bank) {
      items.push(
        {
          key: "bankReview",
          icon: Scale,
          title: t("docUi.dashboard.bankReview"),
          hint: t("docUi.dashboard.bankReviewHint"),
          action: t("docUi.dashboard.actionBankReview"),
          count: figures.bank.review,
          severity: "warning",
          href: "/finance/bank-transactions",
        },
        {
          key: "bankUnmatched",
          icon: Landmark,
          title: t("docUi.dashboard.bankUnmatched"),
          hint: t("docUi.dashboard.bankUnmatchedHint"),
          action: t("docUi.dashboard.actionBankUnmatched"),
          count: figures.bank.unmatched,
          severity: "warning",
          href: "/finance/bank-transactions",
        },
      );
    }
  }
  // Open work first (destructive before warning, then by size).
  const rank = (item: AttentionItem) => (item.severity === "destructive" ? 0 : 1);
  const open = items
    .filter((item) => item.count > 0)
    .sort((a, b) => rank(a) - rank(b) || b.count - a.count);
  const cleared = items.filter((item) => item.count === 0);

  return (
    <section aria-labelledby="dash-attention" className="flex flex-col gap-3" aria-busy={loading}>
      <SectionHeading
        id="dash-attention"
        title={t("docUi.dashboard.attentionTitle")}
        description={t("docUi.dashboard.attentionDescription")}
        badge={
          !loading && !failed ? (
            <EnterpriseBadge variant={open.length > 0 ? "warning" : "success"}>
              {open.length > 0 ? null : <CircleCheck />}
              {open.length > 0
                ? t("docUi.dashboard.openQueues", { count: open.length })
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
      ) : loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
            >
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3 w-48" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {open.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {open.map((item) => (
                <InsightCard
                  key={item.key}
                  icon={item.icon}
                  tone={item.severity}
                  emphasis
                  label={item.title}
                  value={item.count}
                  context={item.hint}
                  href={item.href}
                  actionLabel={item.action}
                  direction={direction}
                />
              ))}
            </div>
          ) : null}
          {cleared.length > 0 ? (
            <ul className="flex flex-wrap items-center gap-2">
              {cleared.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-caption text-muted-foreground transition-colors duration-(--duration-base) hover:border-input-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    <CircleCheck className="size-3.5 text-success-soft-foreground" aria-hidden />
                    {item.title}
                    <span className="text-placeholder">· {t("docUi.dashboard.allClear")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}

interface Metric {
  key: string;
  labelKey: MessageKey;
  value: string;
  icon: LucideIcon;
  tone: InsightTone;
  context: string;
  bar?: number;
}

function MetricsStrip({
  data,
  loading,
  periodLabel,
}: {
  data: SalesPerformanceDashboard | null;
  loading: boolean;
  periodLabel: string;
}) {
  const { t } = useLocale();
  const kpis = data?.kpis;
  const metrics: Metric[] = kpis
    ? [
        {
          key: "newLeads",
          labelKey: "crm.leads.dashboard.newLeads",
          value: String(kpis.newLeads),
          icon: UserPlus,
          tone: "info",
          context: t("docUi.dashboard.newLeadsContext", { period: periodLabel }),
        },
        {
          key: "inProgress",
          labelKey: "crm.leads.dashboard.inProgress",
          value: String(kpis.inProgress),
          icon: Clock,
          tone: "neutral",
          context: t("docUi.dashboard.nowContext"),
        },
        {
          key: "converted",
          labelKey: "crm.leads.dashboard.converted",
          value: String(kpis.converted),
          icon: ArrowRightLeft,
          tone: "success",
          context: t("docUi.dashboard.convertedContext", { period: periodLabel }),
        },
        {
          key: "conversionRate",
          labelKey: "crm.leads.dashboard.conversionRate",
          value: `${kpis.conversionRate}%`,
          icon: Percent,
          tone: "success",
          context: t("docUi.dashboard.conversionContext", { period: periodLabel }),
          bar: kpis.conversionRate,
        },
        {
          key: "orders",
          labelKey: "docUi.dashboard.ordersInScope",
          value: String(kpis.orders),
          icon: ShoppingBag,
          tone: "neutral",
          context: t("docUi.dashboard.ordersContext", { period: periodLabel }),
        },
        {
          key: "delivered",
          labelKey: "crm.leads.dashboard.delivered",
          value: String(kpis.delivered),
          icon: PackageCheck,
          tone: "success",
          context: t("docUi.dashboard.deliveredContext", { period: periodLabel }),
        },
      ]
    : [];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {loading || !kpis
        ? Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
            >
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-7 w-12" />
            </div>
          ))
        : metrics.map((metric) => (
            <InsightCard
              key={metric.key}
              icon={metric.icon}
              tone={metric.tone}
              label={t(metric.labelKey)}
              value={metric.value}
              context={metric.context}
            >
              {metric.bar !== undefined ? (
                <InsightBar value={metric.bar} label={`${t(metric.labelKey)} ${metric.value}`} />
              ) : null}
            </InsightCard>
          ))}
    </div>
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
