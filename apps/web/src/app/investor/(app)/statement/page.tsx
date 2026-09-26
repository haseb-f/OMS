"use client";

import { useCallback, useState } from "react";
import { Receipt } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { SelectFilter } from "@/components/shared/data-table/select-filter";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import {
  investorPortalService,
  type InvestorLedgerEntryType,
} from "@/services/investor-portal-service";
import { usePortalQuery } from "../_components/use-portal-query";
import { PortalPageState } from "../_components/portal-page-state";
import { PortalPager } from "../_components/portal-pager";
import { PortalStatCard } from "../_components/portal-stat-card";
import type { MessageKey } from "@/i18n/translate";

const ENTRY_TYPES: InvestorLedgerEntryType[] = [
  "CAPITAL_FUNDED",
  "PROFIT_ENTITLEMENT",
  "PROFIT_PAYMENT",
  "CAPITAL_RETURN",
  "ADJUSTMENT",
  "REVERSAL",
];

export default function InvestorPortalStatementPage() {
  const { t } = useLocale();
  const [page, setPage] = useState(1);
  // SelectFilter's "" is its "All types" row (no `type` param sent).
  const [type, setType] = useState<InvestorLedgerEntryType | "">("");

  const fetchStatement = useCallback(
    () =>
      investorPortalService.statement({
        page,
        type: type ? [type] : undefined,
      }),
    [page, type],
  );
  const { data, error, isLoading, reload } = usePortalQuery(fetchStatement);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">
        {t("investorPortal.statement.title")}
      </h1>

      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <PortalStatCard
            label={t("investors.ledger.summary.totalConfirmedCapital")}
            value={data.summary.totalConfirmedCapital}
          />
          <PortalStatCard
            label={t("investors.ledger.summary.capitalReturned")}
            value={data.summary.capitalReturned}
          />
          <PortalStatCard
            label={t("investors.ledger.summary.remainingCapitalPosition")}
            value={data.summary.remainingCapitalPosition}
          />
          <PortalStatCard
            label={t("investors.ledger.summary.totalApprovedProfit")}
            value={data.summary.totalApprovedProfit}
          />
          <PortalStatCard
            label={t("investors.ledger.summary.totalProfitPaid")}
            value={data.summary.totalProfitPaid}
            tone="success"
          />
          <PortalStatCard
            label={t("investors.ledger.summary.outstandingProfit")}
            value={data.summary.outstandingProfit}
            tone="warning"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SelectFilter
          label={t("investorPortal.statement.filters.allTypes")}
          allLabel={t("investorPortal.statement.filters.allTypes")}
          value={type}
          onChange={(value) => {
            setType(value as InvestorLedgerEntryType | "");
            setPage(1);
          }}
          options={ENTRY_TYPES.map((entryType) => ({
            value: entryType,
            label: t(`investors.ledger.entryType.${entryType}` as MessageKey),
          }))}
        />
      </div>

      <PortalPageState
        isLoading={isLoading}
        error={error}
        isEmpty={data?.items.length === 0}
        emptyIcon={Receipt}
        emptyTitle={t("investorPortal.statement.empty")}
        emptyDescription={t("investorPortal.statement.emptyDescription")}
        onRetry={reload}
      >
        {data && (
          <EnterpriseCard>
            <EnterpriseCardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("investorPortal.statement.fields.date")}</TableHead>
                      <TableHead>{t("investorPortal.statement.fields.type")}</TableHead>
                      <TableHead>{t("investorPortal.statement.fields.description")}</TableHead>
                      <TableHead>{t("investorPortal.statement.fields.debit")}</TableHead>
                      <TableHead>{t("investorPortal.statement.fields.credit")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>{formatDate(entry.entryDate)}</TableCell>
                        <TableCell>
                          {t(`investors.ledger.entryType.${entry.type}` as MessageKey)}
                        </TableCell>
                        <TableCell>{entry.description}</TableCell>
                        <TableCell>
                          {entry.debitAmount > 0 ? formatMoney(entry.debitAmount) : ""}
                        </TableCell>
                        <TableCell>
                          {entry.creditAmount > 0 ? formatMoney(entry.creditAmount) : ""}
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
