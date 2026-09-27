"use client";

import { useCallback } from "react";
import Link from "next/link";
import { Briefcase } from "lucide-react";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { formatAmount } from "@/lib/money";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import { useInvestorPortalAuth } from "@/providers/investor-portal-auth-provider";
import { investorPortalService } from "@/services/investor-portal-service";
import { usePortalQuery } from "../_components/use-portal-query";
import { PortalPageState } from "../_components/portal-page-state";
import { KpiCard } from "@/components/shared/kpi-card";
import { OpportunityStatusBadge } from "../_components/portal-status-badge";

export default function InvestorPortalDashboardPage() {
  const { t } = useLocale();
  const { investor } = useInvestorPortalAuth();
  const fetchDashboard = useCallback(() => investorPortalService.dashboard(), []);
  const { data, error, isLoading, reload } = usePortalQuery(fetchDashboard);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-ui-title text-foreground">{t("investorPortal.dashboard.title")}</h1>
        {investor && (
          <p className="mt-1 text-caption text-muted-foreground">
            {t("investorPortal.dashboard.welcome", { name: investor.name })}
          </p>
        )}
      </div>

      <PortalPageState isLoading={isLoading} error={error} onRetry={reload}>
        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <KpiCard
                label={t("investors.ledger.summary.totalConfirmedCapital")}
                value={formatAmount(data.totalConfirmedCapital)}
              />
              <KpiCard
                label={t("investors.ledger.summary.capitalReturned")}
                value={formatAmount(data.capitalReturned)}
              />
              <KpiCard
                label={t("investors.ledger.summary.remainingCapitalPosition")}
                value={formatAmount(data.remainingCapitalPosition)}
              />
              <KpiCard
                label={t("investors.ledger.summary.totalApprovedProfit")}
                value={formatAmount(data.totalApprovedProfit)}
              />
              <KpiCard
                label={t("investors.ledger.summary.totalProfitPaid")}
                value={formatAmount(data.totalProfitPaid)}
              />
              <KpiCard
                label={t("investors.ledger.summary.outstandingProfit")}
                value={formatAmount(data.outstandingProfit)}
              />
            </div>

            <EnterpriseCard>
              <EnterpriseCardHeader className="flex flex-row items-center justify-between">
                <EnterpriseCardTitle>
                  {t("investorPortal.dashboard.recentInvestments")}
                </EnterpriseCardTitle>
                <Link
                  href="/investor/investments"
                  className="text-caption font-medium text-primary hover:underline"
                >
                  {t("investorPortal.dashboard.viewAllInvestments")}
                </Link>
              </EnterpriseCardHeader>
              <EnterpriseCardContent>
                {data.recentInvestments.length === 0 ? (
                  <EmptyState
                    icon={Briefcase}
                    title={t("investorPortal.dashboard.noRecentInvestments")}
                  />
                ) : (
                  <div className="flex flex-col divide-y divide-border">
                    {data.recentInvestments.map((item) => (
                      <Link
                        key={item.subscriptionId}
                        href={`/investor/investments/${item.subscriptionId}`}
                        className="-mx-2 flex flex-col gap-1 rounded-sm px-2 py-3 transition-colors duration-(--duration-base) hover:bg-table-row-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus-ring sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">
                            {item.opportunityName}
                          </span>
                          <OpportunityStatusBadge status={item.status} />
                        </div>
                        <div className="flex items-center gap-4 text-caption text-muted-foreground">
                          <span className="num">{formatDate(item.startDate)}</span>
                          <span className="font-medium text-foreground">
                            <span className="num">{formatAmount(item.confirmedFunding)}</span>
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </EnterpriseCardContent>
            </EnterpriseCard>
          </>
        )}
      </PortalPageState>
    </div>
  );
}
