"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Coins, TrendingUp, Users } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { DetailSection } from "@/components/shared/detail-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/business/status-badge";
import {
  investmentOpportunitiesService,
  type InvestmentOpportunityRow,
} from "@/services/investment-opportunities-service";
import {
  capitalContributionsService,
  type CapitalContributionRow,
} from "@/services/capital-contributions-service";
import { useLocale } from "@/providers/locale-provider";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";

export default function InvestorDashboardPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [opportunities, setOpportunities] = useState<InvestmentOpportunityRow[] | null>(null);
  const [recentContributions, setRecentContributions] = useState<CapitalContributionRow[] | null>(
    null,
  );

  useEffect(() => {
    investmentOpportunitiesService
      .list({
        pageSize: 100,
        status: ["DRAFT", "OPEN", "FUNDED", "ACTIVE"],
        sortBy: "endDate",
        sortOrder: "asc",
      })
      .then((result) => setOpportunities(result.items));
    capitalContributionsService
      .list({ pageSize: 10, status: ["CONFIRMED"] })
      .then((result) => setRecentContributions(result.items));
  }, []);

  if (!opportunities || !recentContributions) return null;

  const activeOpportunities = opportunities.filter((o) =>
    ["OPEN", "FUNDED", "ACTIVE"].includes(o.status),
  );
  const targetCapital = activeOpportunities.reduce((sum, o) => sum + o.targetCapital, 0);
  const confirmedCapital = activeOpportunities.reduce(
    (sum, o) => sum + o.confirmedFundedCapital,
    0,
  );
  const totalInvestors = new Set(
    activeOpportunities.flatMap((o) => o.subscriptions.map((s) => s.investorId)),
  ).size;

  const endingSoon = activeOpportunities.filter(
    (o) => o.daysRemaining >= 0 && o.daysRemaining <= 30,
  );

  return (
    <PageWorkspace
      title={t("investors.dashboard.title")}
      description={t("investors.dashboard.description")}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={Briefcase}
          label={t("investors.dashboard.stats.activeOpportunities")}
          value={activeOpportunities.length}
        />
        <KpiCard
          icon={Coins}
          label={t("investors.dashboard.stats.targetCapital")}
          value={formatMoney(targetCapital)}
        />
        <KpiCard
          icon={TrendingUp}
          label={t("investors.dashboard.stats.confirmedCapital")}
          value={formatMoney(confirmedCapital)}
        />
        <KpiCard
          icon={Users}
          label={t("investors.dashboard.stats.totalInvestors")}
          value={totalInvestors}
        />
      </div>

      <DetailSection title={t("investors.dashboard.endingSoon.title")}>
        {endingSoon.length === 0 ? (
          <EmptyState icon={Briefcase} title={t("investors.dashboard.endingSoon.none")} />
        ) : (
          <div className="flex flex-col gap-2">
            {endingSoon.map((o) => (
              <button
                key={o.id}
                type="button"
                className="flex items-center justify-between rounded-md border border-border p-2 text-start hover:bg-muted"
                onClick={() => router.push(`/investors/opportunities/${o.id}`)}
              >
                <span className="font-medium">
                  {o.code} — {o.nameAr}
                </span>
                <StatusBadge
                  label={t("investors.dashboard.endingSoon.within", { days: o.daysRemaining })}
                  tone={
                    o.daysRemaining <= 7
                      ? "destructive"
                      : o.daysRemaining <= 15
                        ? "warning"
                        : "neutral"
                  }
                />
              </button>
            ))}
          </div>
        )}
      </DetailSection>

      <DetailSection title={t("investors.dashboard.recentContributions.title")}>
        {recentContributions.length === 0 ? (
          <EmptyState icon={Coins} title={t("investors.dashboard.recentContributions.none")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-body">
              <thead>
                <tr className="border-b border-border text-caption text-muted-foreground">
                  <th className="p-2 text-start">{t("investors.contributions.fields.investor")}</th>
                  <th className="p-2 text-start">{t("investors.opportunities.fields.code")}</th>
                  <th className="p-2 text-start">{t("investors.contributions.fields.date")}</th>
                  <th className="p-2 text-start">{t("investors.contributions.fields.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {recentContributions.map((c) => (
                  <tr key={c.id} className="border-b border-border/60">
                    <td className="p-2 font-medium">{c.investorName}</td>
                    <td className="p-2">{c.opportunityCode}</td>
                    <td className="p-2">{formatDate(c.contributionDate)}</td>
                    <td className="p-2">{formatMoney(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DetailSection>
    </PageWorkspace>
  );
}
