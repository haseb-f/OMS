"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { RowIdentityLink } from "@/components/shared/data-table/row-identity-link";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import { investorPortalService } from "@/services/investor-portal-service";
import { usePortalQuery } from "../_components/use-portal-query";
import { PortalPageState } from "../_components/portal-page-state";
import { PortalPager } from "../_components/portal-pager";
import { OpportunityStatusBadge } from "../_components/portal-status-badge";

export default function InvestorPortalInvestmentsPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const fetchInvestments = useCallback(() => investorPortalService.investments({ page }), [page]);
  const { data, error, isLoading, reload } = usePortalQuery(fetchInvestments);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">
        {t("investorPortal.investments.title")}
      </h1>

      <PortalPageState
        isLoading={isLoading}
        error={error}
        isEmpty={data?.items.length === 0}
        emptyIcon={Briefcase}
        emptyTitle={t("investorPortal.investments.empty")}
        emptyDescription={t("investorPortal.investments.emptyDescription")}
        onRetry={reload}
      >
        {data && (
          <EnterpriseCard>
            <EnterpriseCardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("investorPortal.investments.fields.opportunity")}</TableHead>
                      <TableHead>{t("investorPortal.investments.fields.status")}</TableHead>
                      <TableHead>{t("investorPortal.investments.fields.startDate")}</TableHead>
                      <TableHead>
                        {t("investorPortal.investments.fields.confirmedFunding")}
                      </TableHead>
                      <TableHead>
                        {t("investorPortal.investments.fields.participationPercent")}
                      </TableHead>
                      <TableHead>{t("investorPortal.investments.fields.approvedProfit")}</TableHead>
                      <TableHead>{t("investorPortal.investments.fields.paidProfit")}</TableHead>
                      <TableHead>
                        {t("investorPortal.investments.fields.outstandingProfit")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((item) => {
                      const href = `/investor/investments/${item.subscriptionId}`;
                      return (
                        <TableRow
                          key={item.subscriptionId}
                          className="cursor-pointer"
                          onClick={() => router.push(href)}
                        >
                          <TableCell className="font-medium text-foreground">
                            <RowIdentityLink href={href}>{item.opportunityName}</RowIdentityLink>
                          </TableCell>
                          <TableCell>
                            <OpportunityStatusBadge status={item.status} />
                          </TableCell>
                          <TableCell>{formatDate(item.startDate)}</TableCell>
                          <TableCell>{formatMoney(item.confirmedFunding)}</TableCell>
                          <TableCell>{item.participationPercent.toFixed(2)}%</TableCell>
                          <TableCell>{formatMoney(item.approvedProfit)}</TableCell>
                          <TableCell>{formatMoney(item.paidProfit)}</TableCell>
                          <TableCell>{formatMoney(item.outstandingProfit)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </EnterpriseCardContent>
          </EnterpriseCard>
        )}
        <PortalPager
          page={data?.page ?? 1}
          pageSize={data?.pageSize ?? 20}
          total={data?.total ?? 0}
          onPageChange={setPage}
        />
      </PortalPageState>
    </div>
  );
}
