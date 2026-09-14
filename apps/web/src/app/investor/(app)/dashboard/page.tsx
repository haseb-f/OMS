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
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import { useInvestorPortalAuth } from "@/providers/investor-portal-auth-provider";
import { investorPortalService } from "@/services/investor-portal-service";
import { usePortalQuery } from "../_components/use-portal-query";
import { PortalPageState } from "../_components/portal-page-state";
import { PortalStatCard } from "../_components/portal-stat-card";
import { OpportunityStatusBadge } from "../_components/portal-status-badge";

export default function InvestorPortalDashboardPage() {
  const { t } = useLocale();
  const { investor } = useInvestorPortalAuth();
  const fetchDashboard = useCallback(() => investorPortalService.dashboard(), []);
  const { data, error, isLoading, reload } = usePortalQuery(fetchDashboard);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">
          {t("investorPortal.dashboard.title")}
        </h1>
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
              <PortalStatCard
                label={t("investors.ledger.summary.totalConfirmedCapital")}
                value={data.totalConfirmedCapital}
              />
              <PortalStatCard
                label={t("investors.ledger.summary.capitalReturned")}
                value={data.capitalReturned}
              />
              <PortalStatCard
                label={t("investors.ledger.summary.remainingCapitalPosition")}
                value={data.remainingCapitalPosition}
              />
              <PortalStatCard
                label={t("investors.ledger.summary.totalApprovedProfit")}
                value={data.totalApprovedProfit}
              />
              <PortalStatCard
                label={t("investors.ledger.summary.totalProfitPaid")}
                value={data.totalProfitPaid}
                tone="success"
              />
              <PortalStatCard
                label={t("investors.ledger.summary.outstandingProfit")}
                value={data.outstandingProfit}
                tone="warning"
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
                  <div className="flex flex-col divide-y">
                    {data.recentInvestments.map((item) => (
                      <Link
                        key={item.subscriptionId}
                        href={`/investor/investments/${item.subscriptionId}`}
                        className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 hover:opacity-80 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">
                            {item.opportunityName}
                          </span>
                          <OpportunityStatusBadge status={item.status} />
                        </div>
                        <div className="flex items-center gap-4 text-caption text-muted-foreground">
                          <span>{formatDate(item.startDate)}</span>
                          <span className="font-medium text-foreground">
                            {formatMoney(item.confirmedFunding)}
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
