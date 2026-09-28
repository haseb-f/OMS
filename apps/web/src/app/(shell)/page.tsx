"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Boxes,
  CalendarClock,
  ClipboardCheck,
  Clock,
  Contact,
  Landmark,
  ShoppingBag,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { EnterpriseButton } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { KpiCard, type KpiTone } from "@/components/shared/kpi-card";
import { navigationConfig } from "@/navigation/navigation.config";
import { usePinnedItems } from "@/hooks/use-pinned-items";
import { useRecentPages } from "@/hooks/use-recent-pages";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import type { MessageKey } from "@/i18n/translate";
import {
  salesPerformanceService,
  type SalesPeriod,
  type SalesPerformanceDashboard,
} from "@/services/sales-performance-service";
import { loadPendingFigures, useLoad } from "@/components/dashboard/dashboard-data";
import { DashboardPilot } from "@/components/dashboard/dashboard-pilot";
import { useUiPilot } from "@/providers/ui-pilot-provider";

const PERIOD_LABEL_KEY: Record<SalesPeriod, MessageKey> = {
  today: "crm.leads.dashboard.today",
  week: "crm.leads.dashboard.week",
  month: "crm.leads.dashboard.month",
};

/**
 * Role-relevant home: every tile is a real figure from an existing endpoint
 * the user can access, and links to the list behind it (with the same filter
 * when that list supports one). Users with nothing to show get their
 * shortcuts instead of decorative counts or permanently empty cards.
 */
export default function DashboardPage() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const showSales = hasPermission("crm.leads.view") || hasPermission("store-orders.view");
  const showPaymentReview = hasPermission("sales.receipts.view");
  const showBank = hasPermission("accounting.bank-transactions.view");
  const [period, setPeriod] = useState<SalesPeriod>("month");
  const pilot = useUiPilot().active;

  if (pilot) {
    return (
      <DashboardPilot
        showSales={showSales}
        showPaymentReview={showPaymentReview}
        showBank={showBank}
        period={period}
        onPeriodChange={setPeriod}
        emptyState={<ShortcutsEmptyState />}
      />
    );
  }

  return (
    <PageWorkspace
      title={t("dashboard.welcomeTitle")}
      description={t("dashboard.welcomeSubtitle")}
      actions={
        showSales ? (
          <ToggleGroup
            type="single"
            value={period}
            aria-label={t("docUi.dashboard.period")}
            onValueChange={(value) => {
              if (value) setPeriod(value as SalesPeriod);
            }}
          >
            {(["today", "week", "month"] as const).map((item) => (
              <ToggleGroupItem key={item} value={item} size="default">
                {t(PERIOD_LABEL_KEY[item])}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        {/* Pending work first: it is what the user can act on right now. */}
        {showPaymentReview || showBank ? (
          <PendingWorkSection showPaymentReview={showPaymentReview} showBank={showBank} />
        ) : null}
        {showSales ? <SalesSection period={period} /> : null}
        {!showSales && !showPaymentReview && !showBank ? <ShortcutsEmptyState /> : null}
      </div>
    </PageWorkspace>
  );
}

function SectionHeading({ children }: { children: string }) {
  return <h2 className="text-card-title">{children}</h2>;
}

function KpiSkeletonGrid({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <KpiCard key={index} size="compact" label="" isLoading />
      ))}
    </>
  );
}

const KPI_GRID = "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 min-[1700px]:grid-cols-8";

interface SalesTile {
  key: keyof SalesPerformanceDashboard["kpis"];
  labelKey: MessageKey;
  icon: LucideIcon;
  tone: KpiTone;
  href?: string;
  format?: (value: number) => string;
}

/** Only tiles whose list supports the same filter get a drill-down link. */
const SALES_TILES: SalesTile[] = [
  { key: "newLeads", labelKey: "crm.leads.dashboard.newLeads", icon: Contact, tone: "muted" },
  { key: "inProgress", labelKey: "crm.leads.dashboard.inProgress", icon: Clock, tone: "muted" },
  {
    key: "dueToday",
    labelKey: "crm.leads.dashboard.dueToday",
    icon: CalendarClock,
    tone: "warning",
    href: "/crm/leads?followUp=today",
  },
  {
    key: "overdue",
    labelKey: "crm.leads.dashboard.overdue",
    icon: Bell,
    tone: "destructive",
    href: "/crm/leads?followUp=overdue",
  },
  {
    key: "converted",
    labelKey: "crm.leads.dashboard.converted",
    icon: TrendingUp,
    tone: "muted",
  },
  { key: "orders", labelKey: "crm.leads.dashboard.orders", icon: ShoppingBag, tone: "muted" },
  { key: "delivered", labelKey: "crm.leads.dashboard.delivered", icon: Boxes, tone: "muted" },
  {
    key: "conversionRate",
    labelKey: "crm.leads.dashboard.conversionRate",
    icon: TrendingUp,
    tone: "muted",
    format: (value) => `${value}%`,
  },
];

function SalesSection({ period }: { period: SalesPeriod }) {
  const { t } = useLocale();
  const loader = useMemo(() => () => salesPerformanceService.dashboard(period), [period]);
  const { state, retry } = useLoad(loader);

  return (
    <section className="flex flex-col gap-2" aria-busy={state.status === "loading"}>
      <SectionHeading>{t("docUi.dashboard.salesTitle")}</SectionHeading>
      {state.status === "error" ? (
        <ErrorState description={t("docUi.dashboard.loadFailed")} onRetry={() => void retry()} />
      ) : (
        <div className={KPI_GRID}>
          {state.status === "loading" ? (
            <KpiSkeletonGrid count={SALES_TILES.length} />
          ) : (
            SALES_TILES.map((tile) => {
              const value = state.data.kpis[tile.key];
              return (
                <KpiCard
                  key={tile.key}
                  size="compact"
                  icon={tile.icon}
                  tone={tile.tone}
                  label={t(tile.labelKey)}
                  value={tile.format ? tile.format(value) : value}
                  href={tile.href}
                />
              );
            })
          )}
        </div>
      )}
      {state.status === "ready" ? <RankingPanel data={state.data} /> : null}
    </section>
  );
}

function RankingPanel({ data }: { data: SalesPerformanceDashboard }) {
  const { t } = useLocale();
  const self = data.ranking.self;
  const leaderboard = data.ranking.leaderboard.slice(0, 8);

  return (
    <EnterpriseCard size="sm">
      <EnterpriseCardHeader className="flex flex-row items-baseline justify-between gap-2">
        <EnterpriseCardTitle>{t("crm.leads.dashboard.ranking")}</EnterpriseCardTitle>
        <span className="text-caption text-muted-foreground">
          <span className="num font-medium text-foreground">
            {t("docUi.dashboard.rank", { rank: self.rank, of: self.of })}
          </span>
          {" · "}
          <span className="num">{t("docUi.dashboard.ordersCount", { count: self.orders })}</span>
        </span>
      </EnterpriseCardHeader>
      {leaderboard.length > 0 ? (
        <EnterpriseCardContent>
          <ol className="grid grid-cols-1 gap-x-8 lg:grid-flow-col lg:grid-cols-2 lg:grid-rows-4 [&>li]:border-b [&>li]:border-border">
            {leaderboard.map((row) => (
              <li
                key={`${row.rank}-${row.userId}`}
                className="flex items-center justify-between gap-3 py-1 text-table"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="num w-6 shrink-0 text-muted-foreground">#{row.rank}</span>
                  <span className="truncate">{row.displayName}</span>
                </span>
                <span className="num shrink-0 font-medium">{row.orders}</span>
              </li>
            ))}
          </ol>
        </EnterpriseCardContent>
      ) : null}
    </EnterpriseCard>
  );
}

function PendingWorkSection({
  showPaymentReview,
  showBank,
}: {
  showPaymentReview: boolean;
  showBank: boolean;
}) {
  const { t } = useLocale();
  const loader = useMemo(
    () => () => loadPendingFigures(showPaymentReview, showBank),
    [showPaymentReview, showBank],
  );
  const { state, retry } = useLoad(loader);
  const tileCount = (showPaymentReview ? 1 : 0) + (showBank ? 2 : 0);

  return (
    <section className="flex flex-col gap-2" aria-busy={state.status === "loading"}>
      <SectionHeading>{t("docUi.dashboard.pendingTitle")}</SectionHeading>
      {state.status === "error" ? (
        <ErrorState description={t("docUi.dashboard.loadFailed")} onRetry={() => void retry()} />
      ) : (
        <div className={KPI_GRID}>
          {state.status === "loading" ? (
            <KpiSkeletonGrid count={tileCount} />
          ) : (
            <>
              {state.data.paymentReview !== null ? (
                <KpiCard
                  size="compact"
                  icon={ClipboardCheck}
                  tone={state.data.paymentReview > 0 ? "warning" : "muted"}
                  label={t("docUi.dashboard.paymentReview")}
                  description={t("docUi.dashboard.paymentReviewHint")}
                  value={state.data.paymentReview}
                  href="/finance/payment-review"
                />
              ) : null}
              {state.data.bank ? (
                <>
                  <KpiCard
                    size="compact"
                    icon={Landmark}
                    tone={state.data.bank.unmatched > 0 ? "warning" : "muted"}
                    label={t("docUi.dashboard.bankUnmatched")}
                    value={state.data.bank.unmatched}
                    href="/finance/bank-transactions"
                  />
                  <KpiCard
                    size="compact"
                    icon={Landmark}
                    tone={state.data.bank.review > 0 ? "warning" : "muted"}
                    label={t("docUi.dashboard.bankReview")}
                    value={state.data.bank.review}
                    href="/finance/bank-transactions"
                  />
                </>
              ) : null}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** No figures apply to this role: a concise empty state with the user's own shortcuts. */
function ShortcutsEmptyState() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const { pinnedIds } = usePinnedItems();
  const recentIds = useRecentPages();

  const shortcuts = useMemo(() => {
    const byId = new Map(navigationConfig.map((item) => [item.id, item]));
    const seen = new Set<string>();
    return [...pinnedIds, ...recentIds]
      .map((id) => byId.get(id))
      .filter((item): item is NonNullable<typeof item> => {
        if (!item?.route || item.route === "/" || seen.has(item.id)) return false;
        seen.add(item.id);
        return (item.permissions ?? []).every(hasPermission);
      })
      .slice(0, 8);
  }, [pinnedIds, recentIds, hasPermission]);

  return (
    <EnterpriseCard size="sm">
      <EnterpriseCardContent className="flex flex-col gap-3">
        <EmptyState
          title={t("docUi.dashboard.emptyTitle")}
          description={t("docUi.dashboard.emptyDescription")}
        />
        <div className="flex flex-col gap-2">
          <h2 className="text-caption font-medium text-muted-foreground">
            {t("docUi.dashboard.shortcuts")}
          </h2>
          {shortcuts.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {shortcuts.map((item) => (
                <li key={item.id}>
                  <EnterpriseButton asChild variant="outline" size="sm">
                    <Link href={item.route!}>{t(item.titleKey)}</Link>
                  </EnterpriseButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-caption text-muted-foreground">{t("docUi.dashboard.noShortcuts")}</p>
          )}
        </div>
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}
