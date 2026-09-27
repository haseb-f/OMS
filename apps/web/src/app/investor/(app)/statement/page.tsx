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
  tableNumericCellClass,
  tableTabularCellClass,
} from "@/components/ui/table";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { SelectFilter } from "@/components/shared/data-table/select-filter";
import { formatAmount } from "@/lib/money";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import {
  investorPortalService,
  type InvestorLedgerEntryType,
} from "@/services/investor-portal-service";
import { usePortalQuery } from "../_components/use-portal-query";
import { PortalPageState } from "../_components/portal-page-state";
import { PortalPager } from "../_components/portal-pager";
import { KpiCard } from "@/components/shared/kpi-card";
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
      <h1 className="text-ui-title text-foreground">{t("investorPortal.statement.title")}</h1>

      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <KpiCard
            label={t("investors.ledger.summary.totalConfirmedCapital")}
            value={formatAmount(data.summary.totalConfirmedCapital)}
          />
          <KpiCard
            label={t("investors.ledger.summary.capitalReturned")}
            value={formatAmount(data.summary.capitalReturned)}
          />
          <KpiCard
            label={t("investors.ledger.summary.remainingCapitalPosition")}
            value={formatAmount(data.summary.remainingCapitalPosition)}
          />
          <KpiCard
            label={t("investors.ledger.summary.totalApprovedProfit")}
            value={formatAmount(data.summary.totalApprovedProfit)}
          />
          <KpiCard
            label={t("investors.ledger.summary.totalProfitPaid")}
            value={formatAmount(data.summary.totalProfitPaid)}
          />
          <KpiCard
            label={t("investors.ledger.summary.outstandingProfit")}
            value={formatAmount(data.summary.outstandingProfit)}
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("investorPortal.statement.fields.date")}</TableHead>
                    <TableHead>{t("investorPortal.statement.fields.type")}</TableHead>
                    <TableHead>{t("investorPortal.statement.fields.description")}</TableHead>
                    <TableHead className={tableNumericCellClass}>
                      {t("investorPortal.statement.fields.debit")}
                    </TableHead>
                    <TableHead className={tableNumericCellClass}>
                      {t("investorPortal.statement.fields.credit")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className={tableTabularCellClass}>
                        <span className="num">{formatDate(entry.entryDate)}</span>
                      </TableCell>
                      <TableCell>
                        {t(`investors.ledger.entryType.${entry.type}` as MessageKey)}
                      </TableCell>
                      <TableCell className="whitespace-normal">{entry.description}</TableCell>
                      <TableCell numeric>
                        {formatAmount(entry.debitAmount, { zero: "dash" })}
                      </TableCell>
                      <TableCell numeric>
                        {formatAmount(entry.creditAmount, { zero: "dash" })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
