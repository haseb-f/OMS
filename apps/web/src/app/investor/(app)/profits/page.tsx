"use client";

import { useCallback, useState } from "react";
import { CircleDollarSign } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import { investorPortalService } from "@/services/investor-portal-service";
import { usePortalQuery } from "../_components/use-portal-query";
import { PortalPageState } from "../_components/portal-page-state";
import { PortalPager } from "../_components/portal-pager";
import { DistributionStatusBadge } from "../_components/portal-status-badge";

export default function InvestorPortalProfitsPage() {
  const { t } = useLocale();
  const [page, setPage] = useState(1);
  const fetchProfits = useCallback(() => investorPortalService.profits({ page }), [page]);
  const { data, error, isLoading, reload } = usePortalQuery(fetchProfits);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("investorPortal.profits.title")}</h1>

      <PortalPageState
        isLoading={isLoading}
        error={error}
        isEmpty={data?.items.length === 0}
        emptyIcon={CircleDollarSign}
        emptyTitle={t("investorPortal.profits.empty")}
        emptyDescription={t("investorPortal.profits.emptyDescription")}
        onRetry={reload}
      >
        {data && (
          <EnterpriseCard>
            <EnterpriseCardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("investorPortal.profits.fields.opportunity")}</TableHead>
                      <TableHead>{t("investorPortal.profits.fields.distribution")}</TableHead>
                      <TableHead>{t("investorPortal.profits.fields.approvedProfit")}</TableHead>
                      <TableHead>{t("investorPortal.profits.fields.paid")}</TableHead>
                      <TableHead>{t("investorPortal.profits.fields.outstanding")}</TableHead>
                      <TableHead>{t("investorPortal.profits.fields.status")}</TableHead>
                      <TableHead>{t("investorPortal.profits.fields.lastPaymentDate")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium text-foreground">
                          {item.opportunityName}
                        </TableCell>
                        <TableCell>{item.distributionCode}</TableCell>
                        <TableCell>{formatMoney(item.entitledAmount)}</TableCell>
                        <TableCell>{formatMoney(item.paidAmount)}</TableCell>
                        <TableCell>{formatMoney(item.outstandingAmount)}</TableCell>
                        <TableCell>
                          <DistributionStatusBadge status={item.status} />
                        </TableCell>
                        <TableCell>
                          {item.lastPaymentDate
                            ? formatDate(item.lastPaymentDate)
                            : t("investorPortal.common.notAvailable")}
                        </TableCell>
                      </TableRow>
                    ))}
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
