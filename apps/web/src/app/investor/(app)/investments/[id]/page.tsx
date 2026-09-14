"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, ArrowLeft, FileX } from "lucide-react";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { EnterpriseButton } from "@/components/ui/button";
import { ApiError } from "@/services/api-client";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import { investorPortalService } from "@/services/investor-portal-service";
import { usePortalQuery } from "../../_components/use-portal-query";
import {
  OpportunityStatusBadge,
  DistributionStatusBadge,
  ContributionStatusBadge,
  PaymentStatusBadge,
} from "../../_components/portal-status-badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function InvestorPortalInvestmentDetailPage() {
  const params = useParams<{ id: string }>();
  const { t } = useLocale();
  const fetchDetail = useCallback(
    () => investorPortalService.investmentDetail(params.id),
    [params.id],
  );
  const { data, error, isLoading, reload } = usePortalQuery(fetchDetail);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState
        icon={FileX}
        title={t("investorPortal.investments.detail.notFoundTitle")}
        description={t("investorPortal.investments.detail.notFoundDescription")}
        action={
          <Link href="/investor/investments">
            <EnterpriseButton variant="outline" size="sm">
              {t("investorPortal.investments.detail.backToList")}
            </EnterpriseButton>
          </Link>
        }
      />
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={FileX}
        title={t("investorPortal.common.loadFailed")}
        action={
          <EnterpriseButton variant="outline" size="sm" onClick={reload}>
            {t("investorPortal.common.retry")}
          </EnterpriseButton>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/investor/investments"
          className="inline-flex items-center gap-1 text-caption font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowRight className="size-3.5 rtl:hidden" />
          <ArrowLeft className="hidden size-3.5 rtl:block" />
          {t("investorPortal.investments.detail.backToList")}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-foreground">{data.opportunity.nameAr}</h1>
          <OpportunityStatusBadge status={data.opportunity.status} />
        </div>
        <p className="mt-1 text-caption text-muted-foreground">
          {formatDate(data.opportunity.startDate)} – {formatDate(data.opportunity.endDate)}
        </p>
      </div>

      {/* Overview + Performance */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <EnterpriseCard>
          <EnterpriseCardHeader className="pb-1">
            <EnterpriseCardTitle className="text-caption text-muted-foreground">
              {t("investorPortal.investments.detail.fundedUnits")}
            </EnterpriseCardTitle>
          </EnterpriseCardHeader>
          <EnterpriseCardContent className="text-lg font-semibold tabular-nums">
            {data.performance.fundedUnits}
          </EnterpriseCardContent>
        </EnterpriseCard>
        <EnterpriseCard>
          <EnterpriseCardHeader className="pb-1">
            <EnterpriseCardTitle className="text-caption text-muted-foreground">
              {t("investorPortal.investments.detail.soldUnits")}
            </EnterpriseCardTitle>
          </EnterpriseCardHeader>
          <EnterpriseCardContent className="text-lg font-semibold tabular-nums">
            {data.performance.soldUnits}
          </EnterpriseCardContent>
        </EnterpriseCard>
        <EnterpriseCard>
          <EnterpriseCardHeader className="pb-1">
            <EnterpriseCardTitle className="text-caption text-muted-foreground">
              {t("investorPortal.investments.detail.remainingUnits")}
            </EnterpriseCardTitle>
          </EnterpriseCardHeader>
          <EnterpriseCardContent className="text-lg font-semibold tabular-nums">
            {data.performance.remainingUnits}
          </EnterpriseCardContent>
        </EnterpriseCard>
        <EnterpriseCard>
          <EnterpriseCardHeader className="pb-1">
            <EnterpriseCardTitle className="text-caption text-muted-foreground">
              {t("investorPortal.investments.detail.sellThroughPercent")}
            </EnterpriseCardTitle>
          </EnterpriseCardHeader>
          <EnterpriseCardContent className="text-lg font-semibold tabular-nums">
            {data.performance.sellThroughPercent.toFixed(2)}%
          </EnterpriseCardContent>
        </EnterpriseCard>
      </div>

      {/* My Funding */}
      <EnterpriseCard>
        <EnterpriseCardHeader>
          <EnterpriseCardTitle>
            {t("investorPortal.investments.detail.sectionFunding")}
          </EnterpriseCardTitle>
        </EnterpriseCardHeader>
        <EnterpriseCardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3 text-caption">
            <div>
              <div className="text-muted-foreground">
                {t("investorPortal.investments.fields.committedAmount")}
              </div>
              <div className="mt-0.5 font-semibold text-foreground">
                {formatMoney(data.myFunding.committedAmount)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">
                {t("investorPortal.investments.fields.confirmedFunding")}
              </div>
              <div className="mt-0.5 font-semibold text-foreground">
                {formatMoney(data.myFunding.confirmedFunding)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">
                {t("investorPortal.investments.fields.participationPercent")}
              </div>
              <div className="mt-0.5 font-semibold text-foreground">
                {data.myFunding.participationPercent.toFixed(2)}%
              </div>
            </div>
          </div>

          {data.myFunding.contributions.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              {t("investorPortal.investments.detail.contributionsEmpty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("investorPortal.investments.detail.contributionDate")}</TableHead>
                    <TableHead>
                      {t("investorPortal.investments.detail.contributionAmount")}
                    </TableHead>
                    <TableHead>
                      {t("investorPortal.investments.detail.contributionReference")}
                    </TableHead>
                    <TableHead>
                      {t("investorPortal.investments.detail.contributionStatus")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.myFunding.contributions.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{formatDate(c.contributionDate)}</TableCell>
                      <TableCell>{formatMoney(c.amount)}</TableCell>
                      <TableCell>
                        {c.referenceNumber || t("investorPortal.common.notAvailable")}
                      </TableCell>
                      <TableCell>
                        <ContributionStatusBadge status={c.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </EnterpriseCardContent>
      </EnterpriseCard>

      {/* My Profit */}
      <EnterpriseCard>
        <EnterpriseCardHeader>
          <EnterpriseCardTitle>
            {t("investorPortal.investments.detail.sectionProfit")}
          </EnterpriseCardTitle>
        </EnterpriseCardHeader>
        <EnterpriseCardContent>
          {data.myProfit.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              {t("investorPortal.investments.detail.profitEmpty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("investorPortal.investments.detail.distributionCode")}</TableHead>
                    <TableHead>{t("investorPortal.investments.detail.entitledAmount")}</TableHead>
                    <TableHead>{t("investorPortal.investments.detail.paidAmount")}</TableHead>
                    <TableHead>
                      {t("investorPortal.investments.detail.outstandingAmount")}
                    </TableHead>
                    <TableHead>{t("investorPortal.profits.fields.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.myProfit.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.distributionCode}</TableCell>
                      <TableCell>{formatMoney(p.entitledAmount)}</TableCell>
                      <TableCell>{formatMoney(p.paidAmount)}</TableCell>
                      <TableCell>{formatMoney(p.outstandingAmount)}</TableCell>
                      <TableCell>
                        <DistributionStatusBadge status={p.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </EnterpriseCardContent>
      </EnterpriseCard>

      {/* Payments */}
      <EnterpriseCard>
        <EnterpriseCardHeader>
          <EnterpriseCardTitle>
            {t("investorPortal.investments.detail.sectionPayments")}
          </EnterpriseCardTitle>
        </EnterpriseCardHeader>
        <EnterpriseCardContent>
          {data.payments.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              {t("investorPortal.investments.detail.paymentsEmpty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("investorPortal.investments.detail.paymentDate")}</TableHead>
                    <TableHead>{t("investorPortal.investments.detail.paymentAmount")}</TableHead>
                    <TableHead>{t("investorPortal.investments.detail.paymentReference")}</TableHead>
                    <TableHead>{t("investorPortal.profits.fields.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{formatDate(p.paymentDate)}</TableCell>
                      <TableCell>{formatMoney(p.amount)}</TableCell>
                      <TableCell>
                        {p.referenceNumber || t("investorPortal.common.notAvailable")}
                      </TableCell>
                      <TableCell>
                        <PaymentStatusBadge status={p.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </EnterpriseCardContent>
      </EnterpriseCard>
    </div>
  );
}
