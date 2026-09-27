"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Briefcase, Coins } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { DetailSection } from "@/components/shared/detail-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { KpiCard } from "@/components/shared/kpi-card";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { StatusBadge } from "@/components/business/status-badge";
import { tableIdentityCellClass } from "@/components/ui/table";
import {
  investmentOpportunitiesService,
  type InvestmentOpportunityRow,
  type InvestmentOpportunityStatus,
} from "@/services/investment-opportunities-service";
import {
  capitalContributionsService,
  type CapitalContributionRow,
} from "@/services/capital-contributions-service";
import { useLocale } from "@/providers/locale-provider";
import { formatDate } from "@/lib/date";
import { formatAmount } from "@/lib/money";
import { apiErrorMessage } from "@/lib/toast";

const ACTIVE_STATUSES: InvestmentOpportunityStatus[] = ["OPEN", "FUNDED", "ACTIVE"];
/** The API caps `pageSize` at 200 — the overview walks every page so its totals cover all records. */
const PAGE_SIZE = 200;
const MAX_PAGES = 50;

/** Pages fetched at once after the first — bounded so a large book never floods the API. */
const PAGE_CONCURRENCY = 4;

async function listAllActiveOpportunities(): Promise<InvestmentOpportunityRow[]> {
  const fetchPage = (page: number) =>
    investmentOpportunitiesService.list({
      page,
      pageSize: PAGE_SIZE,
      status: ACTIVE_STATUSES,
      sortBy: "endDate",
      sortOrder: "asc",
    });
  // Page 1 tells us the total; the remaining pages are then fetched in
  // parallel batches and appended in page order.
  const first = await fetchPage(1);
  const rows: InvestmentOpportunityRow[] = [...first.items];
  const pageCount = Math.min(MAX_PAGES, Math.ceil(first.total / PAGE_SIZE));
  for (let start = 2; start <= pageCount; start += PAGE_CONCURRENCY) {
    const pages = Array.from(
      { length: Math.min(PAGE_CONCURRENCY, pageCount - start + 1) },
      (_, offset) => start + offset,
    );
    const results = await Promise.all(pages.map(fetchPage));
    for (const result of results) rows.push(...result.items);
  }
  return rows;
}

interface DashboardData {
  opportunities: InvestmentOpportunityRow[];
  recentContributions: CapitalContributionRow[];
}

export default function InvestorDashboardPage() {
  const { t } = useLocale();
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [opportunities, contributions] = await Promise.all([
        listAllActiveOpportunities(),
        capitalContributionsService.list({ pageSize: 10, status: ["CONFIRMED"] }),
      ]);
      setData({ opportunities, recentContributions: contributions.items });
    } catch (error) {
      setLoadError(apiErrorMessage(error, "errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const opportunities = data?.opportunities ?? [];
  const targetCapital = opportunities.reduce((sum, o) => sum + o.targetCapital, 0);
  const confirmedCapital = opportunities.reduce((sum, o) => sum + o.confirmedFundedCapital, 0);
  const totalInvestors = new Set(
    opportunities.flatMap((o) => o.subscriptions.map((s) => s.investorId)),
  ).size;
  const endingSoon = opportunities.filter((o) => o.daysRemaining >= 0 && o.daysRemaining <= 30);

  const contributionColumns: CompactDetailColumn<CapitalContributionRow>[] = [
    {
      id: "investor",
      header: t("investors.contributions.fields.investor"),
      cell: (row) => <span className={tableIdentityCellClass}>{row.investorName}</span>,
    },
    {
      id: "opportunity",
      header: t("investors.opportunities.fields.code"),
      cell: (row) => <span className="num">{row.opportunityCode}</span>,
    },
    {
      id: "date",
      header: t("investors.contributions.fields.date"),
      cell: (row) => <span className="num">{formatDate(row.contributionDate)}</span>,
    },
    {
      id: "amount",
      header: t("investors.contributions.fields.amount"),
      align: "end",
      cell: (row) => <span className="num">{formatAmount(row.amount, { zero: "dash" })}</span>,
    },
  ];

  return (
    <PageWorkspace
      title={t("investors.dashboard.title")}
      description={t("investors.dashboard.description")}
    >
      {loadError ? (
        <ErrorState description={loadError} onRetry={() => void load()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label={t("investors.dashboard.stats.activeOpportunities")}
              value={opportunities.length}
              description={t("investors.dashboard.stats.activeScope")}
              isLoading={isLoading}
              href="/investors/opportunities"
            />
            <KpiCard
              label={t("investors.dashboard.stats.targetCapital")}
              value={formatAmount(targetCapital)}
              description={t("investors.dashboard.stats.activeScope")}
              isLoading={isLoading}
            />
            <KpiCard
              label={t("investors.dashboard.stats.confirmedCapital")}
              value={formatAmount(confirmedCapital)}
              description={t("investors.dashboard.stats.activeScope")}
              isLoading={isLoading}
            />
            <KpiCard
              label={t("investors.dashboard.stats.totalInvestors")}
              value={totalInvestors}
              description={t("investors.dashboard.stats.activeScope")}
              isLoading={isLoading}
              href="/investors/list"
            />
          </div>

          {data ? (
            <>
              <DetailSection title={t("investors.dashboard.endingSoon.title")}>
                {endingSoon.length === 0 ? (
                  <EmptyState icon={Briefcase} title={t("investors.dashboard.endingSoon.none")} />
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {endingSoon.map((o) => (
                      <li key={o.id}>
                        <Link
                          href={`/investors/opportunities/${o.id}`}
                          className="flex items-center justify-between gap-3 rounded-sm px-2 py-2 transition-colors duration-(--duration-base) hover:bg-table-row-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className="text-caption text-muted-foreground">
                              <span className="num">{o.code}</span>
                            </span>
                            <span className="truncate font-medium text-foreground">{o.nameAr}</span>
                          </span>
                          <StatusBadge
                            label={t("investors.dashboard.endingSoon.within", {
                              days: o.daysRemaining,
                            })}
                            tone={
                              o.daysRemaining <= 7
                                ? "destructive"
                                : o.daysRemaining <= 15
                                  ? "warning"
                                  : "neutral"
                            }
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </DetailSection>

              <DetailSection title={t("investors.dashboard.recentContributions.title")}>
                {data.recentContributions.length === 0 ? (
                  <EmptyState
                    icon={Coins}
                    title={t("investors.dashboard.recentContributions.none")}
                  />
                ) : (
                  <CompactDetailTable
                    columns={contributionColumns}
                    rows={data.recentContributions}
                    rowKey={(row) => row.id}
                  />
                )}
              </DetailSection>
            </>
          ) : null}
        </>
      )}
    </PageWorkspace>
  );
}
