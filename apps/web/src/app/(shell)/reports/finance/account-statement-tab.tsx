"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Landmark } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FinancialReport, normalSideOfAccountType } from "@/components/accounting/financial-report";
import { useOpenFullRecord } from "@/components/shared/record-preview";
import {
  accountingReportsService,
  type AccountLedger,
} from "@/services/accounting-reports-service";
import type { ChartOfAccountRow } from "@/config/master-data/entities";
import { createMasterDataService } from "@/services/master-data-service";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";
import {
  LEDGER_COLUMNS,
  buildLedgerBlock,
  indexLedgerMovements,
  ledgerSummaryItems,
  ledgerTextColumns,
} from "./ledger-lines";
import { useReportQuery } from "./use-report-query";

const accountsService = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");

/** The URL key that keeps the selected account (drill-down target, reloads, shared links). */
const ACCOUNT_PARAM = "account";

/** Account Statement — the General Ledger block of one account (same builder, same numbers). */
export function AccountStatementTab() {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openFullRecord = useOpenFullRecord();
  const { filters, setFilters, params } = useReportQuery();
  const [account, setAccountState] = useState<ChartOfAccountRow | null>(null);
  const accountIdFromUrl = searchParams.get(ACCOUNT_PARAM);
  // The account this tab itself last chose — so its own URL write never
  // triggers a reload of the previous account.
  const selectedIdRef = useRef<string | null>(null);

  // Restore the account from a drill-down link (Trial Balance, Balance
  // Sheet, Income Statement), a reload or a shared link.
  useEffect(() => {
    if (!accountIdFromUrl || accountIdFromUrl === selectedIdRef.current) return;
    const target = accountIdFromUrl;
    selectedIdRef.current = target;
    accountsService
      .get(target)
      .then((row) => {
        // Ignore a late answer once another account was chosen.
        if (selectedIdRef.current === target) setAccountState(row);
      })
      .catch(() => undefined);
  }, [accountIdFromUrl]);

  const setAccount = (next: ChartOfAccountRow | null) => {
    selectedIdRef.current = next?.id ?? null;
    setAccountState(next);
    const query = new URLSearchParams(window.location.search);
    if (next) query.set(ACCOUNT_PARAM, next.id);
    else query.delete(ACCOUNT_PARAM);
    const text = query.toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  };
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
      reportApiError(error, "common.noResults");
    } finally {
      setIsLoading(false);
    }
  }, [account, params]);

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
              normalSide: normalSideOfAccountType(statement.account.accountType),
            },
          ]
        : [],
    [statement],
  );
  const lines = useMemo(() => blocks.map((block) => buildLedgerBlock(block, t)), [blocks, t]);
  const movementIndex = useMemo(() => indexLedgerMovements(blocks), [blocks]);
  const textColumns = useMemo(() => ledgerTextColumns(movementIndex), [movementIndex]);

  return (
    <FinancialReport
      lines={account ? lines : []}
      columns={LEDGER_COLUMNS}
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
      signConvention
      placeholder={
        !account ? (
          <EmptyState
            icon={Landmark}
            title={t("reports.finance.accountStatement.selectAccountTitle")}
            description={t("reports.finance.accountStatement.selectAccountDescription")}
          />
        ) : undefined
      }
      summary={
        statement
          ? {
              items: ledgerSummaryItems(
                t,
                statement,
                normalSideOfAccountType(statement.account.accountType),
              ),
            }
          : undefined
      }
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
  );
}
