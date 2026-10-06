"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarMinus,
  CalendarRange,
  Handshake,
  ListChecks,
  RefreshCw,
  UserRound,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InsightGroup, InsightScope } from "@/components/shared/insight-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { MoneyValue } from "@/components/shared/money-value";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { ReportCard, ReportCardSkeleton } from "@/components/reports/report-card";
import { BarChart } from "@/components/reports/bar-chart";
import { useLiveRefresh, type LiveRefreshState } from "@/components/reports/use-live-refresh";
import {
  salesReportsService,
  type LivePeriod,
  type PaymentMixRow,
  type PerformanceReport,
  type RankBy,
  type RankedEmployee,
  type SalesReportScope,
  type SalesReportsSource,
  type SalesStats,
} from "@/services/sales-reports-service";
import { ApiError } from "@/services/api-client";
import { useLocale } from "@/providers/locale-provider";
import { apiErrorMessage } from "@/lib/toast";
import { formatDate, toISODate } from "@/lib/date";
import { businessPresetRange, formatBusinessDateTime } from "@/lib/business-date";
import { formatNumber } from "@/lib/format-number";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type ReportTab = "live" | "employees" | "teams" | "comparison" | "paymentMix";

const PERIOD_ICON: Record<LivePeriod, LucideIcon> = {
  today: CalendarCheck,
  yesterday: CalendarMinus,
  last7Days: CalendarRange,
  thisMonth: CalendarDays,
  lastMonth: CalendarClock,
};

/** Bars shown in the comparison chart; the table below lists everyone. */
const CHART_LIMIT = 15;
const CARD_GRID = "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4";

function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

function rangeLabel(from: string, to: string): string {
  return from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
}

/** "count" or "amount:<CODE>" — one Select value for the rank-by control. */
type RankValue = "count" | `amount:${string}`;

function parseRank(value: RankValue): { rankBy: RankBy; currency: string | null } {
  return value === "count"
    ? { rankBy: "count", currency: null }
    : { rankBy: "amount", currency: value.slice("amount:".length) };
}

/**
 * Sales reports (R13 spec E) — one view for the company page
 * (`/reports/sales`) and the agent portal (`/agent/reports`): Live period
 * cards, ranked employees, teams, a comparison chart + table and the payment
 * mix. Every figure comes from the API's single metric definitions; the
 * view only arranges them.
 */
export function SalesReportsView({ source }: { source: SalesReportsSource }) {
  const { t } = useLocale();
  const [tab, setTab] = useState<ReportTab>("live");
  const [range, setRange] = useState<DateRangeValue>(() => businessPresetRange("THIS_MONTH"));
  const [rank, setRank] = useState<RankValue>("count");
  const tabs: ReportTab[] =
    source === "agent"
      ? ["live", "employees", "comparison", "paymentMix"]
      : ["live", "employees", "teams", "comparison", "paymentMix"];

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as ReportTab)} className="min-w-0">
      <TabsList variant="line" className="max-w-full flex-wrap justify-start">
        {tabs.map((key) => (
          <TabsTrigger key={key} value={key} className="flex-none">
            {t(`salesReports.tabs.${key}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      <p className="text-caption text-muted-foreground">{t("salesReports.definitions")}</p>
      <TabsContent value={tab} className="min-w-0">
        {tab === "live" ? (
          <LiveTab source={source} />
        ) : (
          <PerformancePanel
            source={source}
            tab={tab}
            range={range}
            onRangeChange={setRange}
            rank={rank}
            onRankChange={setRank}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function RefreshBar<T extends { scope: SalesReportScope }>({
  state,
  auto,
  children,
}: {
  state: LiveRefreshState<T>;
  auto: boolean;
  children?: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {children}
      <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
        <span className="text-caption text-muted-foreground" aria-live="polite">
          {state.data ? t(`salesReports.scope.${state.data.scope}`) : null}
          {state.lastRefreshedAt ? (
            <>
              {" · "}
              {t("salesReports.refresh.lastRefreshed", {
                time: formatBusinessDateTime(new Date(state.lastRefreshedAt)),
              })}
            </>
          ) : null}
          {auto ? (
            <span className="hidden md:inline"> · {t("salesReports.refresh.auto")}</span>
          ) : null}
        </span>
        <EnterpriseButton
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void state.refresh()}
          disabled={state.refreshing}
        >
          <RefreshCw
            data-icon="inline-start"
            className={cn(state.refreshing && "motion-safe:animate-spin")}
          />
          {state.refreshing
            ? t("salesReports.refresh.refreshing")
            : t("salesReports.refresh.action")}
        </EnterpriseButton>
      </div>
    </div>
  );
}

/** Failure / stale banner kept above the last good figures. */
function FreshnessBanner<T>({ state }: { state: LiveRefreshState<T> }) {
  const { t } = useLocale();
  if (state.data && state.error) {
    return (
      <Alert tone="warning">
        {t("salesReports.refresh.failed")} {apiErrorMessage(state.error, "salesReports.loadFailed")}
      </Alert>
    );
  }
  if (state.data && state.isStale) {
    return <Alert tone="warning">{t("salesReports.refresh.stale")}</Alert>;
  }
  return null;
}

/** First-load failure: 403 → no access; anything else → error with retry. */
function LoadFailure<T>({ state }: { state: LiveRefreshState<T> }) {
  const { t } = useLocale();
  if (isForbidden(state.error)) {
    return <EmptyState tone="denied" title={t("salesReports.unavailable")} />;
  }
  return (
    <ErrorState
      title={t("salesReports.loadFailed")}
      description={apiErrorMessage(state.error, "salesReports.loadFailed")}
      onRetry={() => void state.refresh()}
    />
  );
}

function CardSkeletons({ count, className }: { count: number; className: string }) {
  return (
    <InsightGroup className={className} aria-busy>
      {Array.from({ length: count }, (_, index) => (
        <ReportCardSkeleton key={index} />
      ))}
    </InsightGroup>
  );
}

function useStatLines() {
  const { t } = useLocale();
  return useCallback(
    (stats: SalesStats) => [
      { label: t("salesReports.stats.orders"), value: stats.orders },
      { label: t("salesReports.stats.cancelled"), value: stats.cancelled },
      { label: t("salesReports.stats.returned"), value: stats.returned },
    ],
    [t],
  );
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

function LiveTab({ source }: { source: SalesReportsSource }) {
  const { t } = useLocale();
  const statLines = useStatLines();
  const loader = useCallback(() => salesReportsService.live(source), [source]);
  const live = useLiveRefresh(loader, { intervalMs: 60_000 });
  const [selected, setSelected] = useState<LivePeriod>("today");

  if (!live.data && live.error) return <LoadFailure state={live} />;
  const bucket = live.data?.periods.find((entry) => entry.period === selected);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <RefreshBar state={live} auto />
      <FreshnessBanner state={live} />
      {live.data?.scope === "NONE" ? (
        <EmptyState title={t("salesReports.scope.NONE")} />
      ) : live.data ? (
        <InsightGroup className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {live.data.periods.map((entry) => (
            <ReportCard
              key={entry.period}
              title={t(`salesReports.periods.${entry.period}`)}
              icon={PERIOD_ICON[entry.period]}
              tone="revenue"
              figure={entry.valid}
              unit={t("salesReports.stats.valid")}
              meta={<InsightScope kind="period">{rangeLabel(entry.from, entry.to)}</InsightScope>}
              amounts={entry.amounts}
              noAmountsLabel={t("salesReports.stats.noSales")}
              stats={statLines(entry)}
              onSelect={() => setSelected(entry.period)}
              selected={entry.period === selected}
            />
          ))}
        </InsightGroup>
      ) : (
        <CardSkeletons
          count={5}
          className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
        />
      )}
      {bucket && live.data?.scope !== "NONE" ? (
        <DashboardPanel
          id="sales-live-status"
          icon={ListChecks}
          tone="info"
          title={t("salesReports.statusTitle", {
            period: t(`salesReports.periods.${bucket.period}`),
          })}
          description={t("salesReports.statusHint")}
        >
          <div className="p-3">
            <BarChart
              title={rangeLabel(bucket.from, bucket.to)}
              emptyLabel={t("salesReports.employees.empty")}
              items={bucket.statusBreakdown.map((row) => ({
                id: row.code,
                label: statusLabel(t, row.code),
                value: row.count,
                valueLabel: formatNumber(row.count),
              }))}
            />
          </div>
        </DashboardPanel>
      ) : null}
    </div>
  );
}

function statusLabel(t: ReturnType<typeof useLocale>["t"], code: string): string {
  const key = `salesReports.statuses.${code}` as Parameters<typeof t>[0];
  const text = t(key);
  return text === key ? code : text;
}

// ---------------------------------------------------------------------------
// Performance (employees / teams / comparison / payment mix)
// ---------------------------------------------------------------------------

function PerformancePanel({
  source,
  tab,
  range,
  onRangeChange,
  rank,
  onRankChange,
}: {
  source: SalesReportsSource;
  tab: Exclude<ReportTab, "live">;
  range: DateRangeValue;
  onRangeChange: (range: DateRangeValue) => void;
  rank: RankValue;
  onRankChange: (rank: RankValue) => void;
}) {
  const { t } = useLocale();
  const fallback = useMemo(() => businessPresetRange("THIS_MONTH"), []);
  const from = toISODate(range.from ?? fallback.from);
  const to = toISODate(range.to ?? range.from ?? fallback.to);
  const { rankBy, currency } = parseRank(rank);
  const loader = useCallback(
    () => salesReportsService.performance(source, { from, to, rankBy, currency }),
    [source, from, to, rankBy, currency],
  );
  const perf = useLiveRefresh(loader, { intervalMs: null });
  const data = perf.data;

  const currencies = useMemo(() => {
    const codes = new Set(data?.currencies ?? []);
    if (currency) codes.add(currency);
    return [...codes].sort();
  }, [data?.currencies, currency]);

  const filters = (
    <>
      <EnterpriseDateRangePicker value={range} onChange={onRangeChange} />
      {tab !== "paymentMix" ? (
        <Select value={rank} onValueChange={(value) => onRankChange(value as RankValue)}>
          <SelectTrigger
            size="sm"
            className="w-auto min-w-40"
            aria-label={t("salesReports.filters.rankBy")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="count">{t("salesReports.filters.rankByCount")}</SelectItem>
            {currencies.map((code) => (
              <SelectItem key={code} value={`amount:${code}`}>
                {t("salesReports.filters.rankByAmount", { currency: code })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </>
  );

  let body: ReactNode;
  if (!data && perf.error) body = <LoadFailure state={perf} />;
  else if (!data) body = <CardSkeletons count={4} className={CARD_GRID} />;
  else if (data.scope === "NONE") body = <EmptyState title={t("salesReports.scope.NONE")} />;
  else if (tab === "employees") body = <EmployeesTab data={data} />;
  else if (tab === "teams") body = <TeamsTab data={data} />;
  else if (tab === "comparison") body = <ComparisonTab data={data} />;
  else body = <PaymentMixTab rows={data.paymentMix} />;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <RefreshBar state={perf} auto={false}>
        {filters}
      </RefreshBar>
      <FreshnessBanner state={{ ...perf, isStale: false }} />
      <div aria-busy={perf.refreshing || undefined} className="min-w-0">
        {body}
      </div>
    </div>
  );
}

function employeeName(t: ReturnType<typeof useLocale>["t"], row: RankedEmployee): string {
  return row.name ?? t("salesReports.employees.unassigned");
}

function RankBadge({ rank }: { rank: number }) {
  const { t } = useLocale();
  return (
    <EnterpriseBadge variant="outline" className="num font-medium">
      {t("salesReports.employees.rank", { rank })}
    </EnterpriseBadge>
  );
}

function EmployeesTab({ data }: { data: PerformanceReport }) {
  const { t } = useLocale();
  const statLines = useStatLines();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {data.employees.length === 0 ? (
        <EmptyState icon={UserRound} title={t("salesReports.employees.empty")} />
      ) : (
        <InsightGroup className={CARD_GRID}>
          {data.employees.map((row) => (
            <ReportCard
              key={row.userId ?? "unassigned"}
              title={employeeName(t, row)}
              icon={UserRound}
              tone="info"
              figure={row.valid}
              unit={t("salesReports.stats.valid")}
              meta={<RankBadge rank={row.rank} />}
              amounts={row.amounts}
              noAmountsLabel={t("salesReports.stats.noSales")}
              stats={statLines(row)}
            />
          ))}
        </InsightGroup>
      )}
      {data.employeesTruncated ? (
        <p className="text-caption text-muted-foreground">
          {t("salesReports.employees.truncated", { count: data.employees.length })}
        </p>
      ) : null}
      {data.agents ? (
        <section className="flex min-w-0 flex-col gap-2" aria-labelledby="sales-agents-row">
          <h2 id="sales-agents-row" className="text-card-title">
            {t("salesReports.employees.agentsTitle")}
          </h2>
          <InsightGroup className={CARD_GRID}>
            <ReportCard
              title={t("salesReports.employees.agentsHint")}
              icon={Handshake}
              tone="neutral"
              figure={data.agents.valid}
              unit={t("salesReports.stats.valid")}
              amounts={data.agents.amounts}
              noAmountsLabel={t("salesReports.stats.noSales")}
              stats={statLines(data.agents)}
            />
          </InsightGroup>
        </section>
      ) : null}
    </div>
  );
}

function TeamsTab({ data }: { data: PerformanceReport }) {
  const { t } = useLocale();
  const statLines = useStatLines();
  const validOf = useMemo(
    () => new Map(data.employees.map((row) => [row.userId, row.valid])),
    [data.employees],
  );
  if (data.teams === null) {
    return <EmptyState icon={UsersRound} title={t("salesReports.teams.notAvailable")} />;
  }
  if (data.teams.length === 0) {
    return <EmptyState icon={UsersRound} title={t("salesReports.teams.empty")} />;
  }
  const person = (userId: string, name: string) => (
    <span key={userId} className="inline-flex items-baseline gap-1">
      <span className="text-foreground">{name}</span>
      <span className="num text-muted-foreground">{formatNumber(validOf.get(userId) ?? 0)}</span>
    </span>
  );
  return (
    <InsightGroup className="grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
      {data.teams.map((team) => (
        <ReportCard
          key={team.teamId}
          title={team.name}
          icon={UsersRound}
          tone="info"
          figure={team.valid}
          unit={t("salesReports.stats.valid")}
          meta={<RankBadge rank={team.rank} />}
          amounts={team.amounts}
          noAmountsLabel={t("salesReports.stats.noSales")}
          stats={statLines(team)}
        >
          <dl className="flex min-w-0 flex-col gap-1 border-t border-border/60 pt-2 text-caption">
            <div className="flex min-w-0 flex-wrap gap-x-2">
              <dt className="text-muted-foreground">{t("salesReports.teams.manager")}</dt>
              <dd>{person(team.manager.userId, team.manager.name)}</dd>
            </div>
            <div className="flex min-w-0 flex-wrap gap-x-2">
              <dt className="text-muted-foreground">{t("salesReports.teams.members")}</dt>
              <dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5">
                {team.members.length
                  ? team.members.map((member) => person(member.userId, member.name))
                  : t("salesReports.teams.noMembers")}
              </dd>
            </div>
          </dl>
        </ReportCard>
      ))}
    </InsightGroup>
  );
}

function ComparisonTab({ data }: { data: PerformanceReport }) {
  const { t } = useLocale();
  const metric =
    data.rankBy === "amount" && data.currency
      ? t("salesReports.filters.rankByAmount", { currency: data.currency })
      : t("salesReports.filters.rankByCount");
  const valueLabel = (value: number) =>
    data.rankBy === "amount" && data.currency
      ? formatMoney(value, data.currency)
      : formatNumber(value);
  const columns: CompactDetailColumn<RankedEmployee>[] = [
    {
      id: "rank",
      header: t("salesReports.comparison.rank"),
      cell: (row) => <span className="num">{row.rank}</span>,
    },
    { id: "name", header: t("salesReports.comparison.name"), cell: (row) => employeeName(t, row) },
    {
      id: "orders",
      header: t("salesReports.stats.orders"),
      align: "end",
      cell: (row) => <span className="num">{formatNumber(row.orders)}</span>,
    },
    {
      id: "valid",
      header: t("salesReports.filters.rankByCount"),
      align: "end",
      cell: (row) => <span className="num">{formatNumber(row.valid)}</span>,
    },
    {
      id: "cancelled",
      header: t("salesReports.stats.cancelled"),
      align: "end",
      cell: (row) => <span className="num">{formatNumber(row.cancelled)}</span>,
    },
    {
      id: "returned",
      header: t("salesReports.stats.returned"),
      align: "end",
      cell: (row) => <span className="num">{formatNumber(row.returned)}</span>,
    },
    {
      id: "amounts",
      header: t("salesReports.comparison.amounts"),
      align: "end",
      cell: (row) =>
        row.amounts.length ? (
          <span className="flex flex-col items-end">
            {row.amounts.map((line) => (
              <MoneyValue
                key={line.currencyCode}
                value={line.amount}
                currency={line.currencyCode}
              />
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground">{t("salesReports.stats.noSales")}</span>
        ),
    },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <DashboardPanel id="sales-comparison-chart" icon={ListChecks} tone="info" title={metric}>
        <div className="flex min-w-0 flex-col gap-1 p-3">
          <BarChart
            title={t("salesReports.comparison.chartTitle", { metric })}
            emptyLabel={t("salesReports.chart.empty")}
            items={data.employees.slice(0, CHART_LIMIT).map((row) => ({
              id: row.userId ?? "unassigned",
              label: employeeName(t, row),
              value: row.rankValue,
              valueLabel: valueLabel(row.rankValue),
              prefix: `#${row.rank}`,
            }))}
          />
          {data.employees.length > CHART_LIMIT ? (
            <p className="text-caption text-muted-foreground">
              {t("salesReports.comparison.chartLimit", { count: CHART_LIMIT })}
            </p>
          ) : null}
        </div>
      </DashboardPanel>
      <CompactDetailTable
        columns={columns}
        rows={data.employees}
        rowKey={(row) => row.userId ?? "unassigned"}
        empty={t("salesReports.employees.empty")}
        stacked
      />
    </div>
  );
}

function PaymentMixTab({ rows }: { rows: PaymentMixRow[] }) {
  const { t } = useLocale();
  if (rows.length === 0) {
    return <EmptyState icon={Wallet} title={t("salesReports.paymentMix.empty")} />;
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-caption text-muted-foreground">{t("salesReports.paymentMix.hint")}</p>
      <InsightGroup className="grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => {
          const total = row.prepaid.count + row.cod.count;
          return (
            <ReportCard
              key={row.currencyCode}
              title={row.currencyCode}
              icon={Wallet}
              tone="revenue"
              figure={total}
              unit={t("salesReports.stats.valid")}
              amounts={[
                { currencyCode: row.currencyCode, amount: row.prepaid.amount + row.cod.amount },
              ]}
            >
              <PaymentSplit row={row} total={total} />
            </ReportCard>
          );
        })}
      </InsightGroup>
    </div>
  );
}

/** Prepaid vs COD share of one currency: a two-part bar plus labelled lines (never colour alone). */
function PaymentSplit({ row, total }: { row: PaymentMixRow; total: number }) {
  const { t } = useLocale();
  const parts = [
    {
      key: "prepaid",
      label: t("salesReports.paymentMix.prepaid"),
      swatch: "bg-chart-1",
      ...row.prepaid,
    },
    { key: "cod", label: t("salesReports.paymentMix.cod"), swatch: "bg-chart-3", ...row.cod },
  ];
  const percent = (count: number) => (total > 0 ? Math.round((count / total) * 100) : 0);
  return (
    <div className="flex min-w-0 flex-col gap-2 border-t border-border/60 pt-2">
      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {parts.map((part) =>
          part.count > 0 ? (
            <span
              key={part.key}
              className={cn("h-full", part.swatch)}
              style={{ inlineSize: `${(part.count / Math.max(total, 1)) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <dl className="flex min-w-0 flex-col gap-1 text-caption">
        {parts.map((part) => (
          <div
            key={part.key}
            className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3"
          >
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <span className={cn("size-2 shrink-0 rounded-full", part.swatch)} aria-hidden />
              {part.label}
            </dt>
            <dd className="flex flex-wrap items-baseline gap-x-2">
              <span className="num">
                {t("salesReports.paymentMix.line", { count: formatNumber(part.count) })}
              </span>
              <MoneyValue value={part.amount} currency={row.currencyCode} />
              <span className="num font-medium">
                {t("salesReports.paymentMix.share", { percent: percent(part.count) })}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
