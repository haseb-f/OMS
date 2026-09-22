"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Landmark } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FinancialReport } from "@/components/accounting/financial-report";
import { useOpenFullRecord } from "@/components/shared/record-preview";
import {
  accountingReportsService,
  type AccountLedger,
} from "@/services/accounting-reports-service";
import type { ChartOfAccountRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { buildLedgerBlock, indexLedgerMovements, ledgerTextColumns } from "./ledger-lines";
import { useReportQuery } from "./use-report-query";

/** Account Statement — the General Ledger block of one account (same builder, same numbers). */
export function AccountStatementTab() {
  const { t } = useLocale();
  const openFullRecord = useOpenFullRecord();
  const { filters, setFilters, params } = useReportQuery();
  const [account, setAccount] = useState<ChartOfAccountRow | null>(null);
  const [statement, setStatement] = useState<AccountLedger | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!account) {
      setStatement(null);
      return;
    }
    setIsLoading(true);
    try {
      setStatement(await accountingReportsService.accountStatement(account.id, params));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsLoading(false);
    }
  }, [account, params, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const blocks = useMemo(
    () =>
      statement
        ? [
            {
              id: `account:${statement.account.id}`,
              code: statement.account.code,
              label: statement.account.name,
              labelEn: statement.account.nameEn,
              openingBalance: statement.openingBalance,
              periodDebit: statement.periodDebit,
              periodCredit: statement.periodCredit,
              closingBalance: statement.closingBalance,
              movements: statement.movements,
            },
          ]
        : [],
    [statement],
  );
  const lines = useMemo(() => blocks.map((block) => buildLedgerBlock(block, t)), [blocks, t]);
  const movementIndex = useMemo(() => indexLedgerMovements(blocks), [blocks]);
  const textColumns = useMemo(() => ledgerTextColumns(movementIndex), [movementIndex]);

  return (
    <div className="flex flex-col gap-3">
      <FinancialReport
        lines={account ? lines : []}
        columns={[
          { key: "debit", labelKey: "reports.finance.fields.debit" },
          { key: "credit", labelKey: "reports.finance.fields.credit" },
          { key: "balance", labelKey: "reports.finance.fields.runningBalance", emphasize: true },
        ]}
        textColumns={textColumns}
        nameHeaderKey="reports.finance.fields.description"
        defaultExpanded="all"
        exportAllLines
        isLoading={isLoading}
        filters={filters}
        onFiltersChange={setFilters}
        accountFilter={{ value: account, onChange: setAccount, required: true }}
        printTitle={
          statement
            ? `${t("reports.finance.accountStatement.title")} — ${statement.account.code} ${statement.account.name}`
            : t("reports.finance.accountStatement.title")
        }
        exportFileName="account-statement.xlsx"
        onPostingClick={(line) => {
          const movement = movementIndex.get(line.id);
          if (movement) {
            openFullRecord({
              kind: "JOURNAL_ENTRY",
              id: movement.journalEntryId,
              number: movement.entryNumber,
            });
          }
        }}
      />
      {!account ? (
        <EmptyState
          icon={Landmark}
          title={t("reports.finance.accountStatement.selectAccountTitle")}
          description={t("reports.finance.accountStatement.selectAccountDescription")}
        />
      ) : null}
    </div>
  );
}
