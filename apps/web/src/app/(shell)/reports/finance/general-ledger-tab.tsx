"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FinancialReport,
  ReportPagination,
  fetchAllReportPages,
  normalSideOfAccountType,
} from "@/components/accounting/financial-report";
import type { ReportFilterValue } from "@/components/accounting/report-filter-bar";
import { MultiEntityFilter } from "@/components/shared/data-table/multi-entity-filter";
import { useOpenFullRecord } from "@/components/shared/record-preview";
import {
  accountingReportsService,
  type GeneralLedgerResult,
} from "@/services/accounting-reports-service";
import { createMasterDataService } from "@/services/master-data-service";
import type { ChartOfAccountRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";
import {
  LEDGER_COLUMNS,
  buildLedgerBlock,
  indexLedgerMovements,
  ledgerTextColumns,
} from "./ledger-lines";
import { useReportQuery } from "./use-report-query";
import { financeReportHref } from "./report-url";

const accountsService = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");

/** Accounts per page — each carries its full movement list for the period. */
const ACCOUNTS_PER_PAGE = 100;

/** Report rows of each account ledger (opening, movements, closing). */
function toLedgerBlocks(items: GeneralLedgerResult["items"]) {
  return items.map((ledger) => ({
    id: `account:${ledger.account.id}`,
    code: ledger.account.code,
    label: ledger.account.name,
    labelEn: ledger.account.nameEn,
    openingBalance: ledger.openingBalance,
    periodDebit: ledger.periodDebit,
    periodCredit: ledger.periodCredit,
    closingBalance: ledger.closingBalance,
    movements: ledger.movements,
    normalSide: normalSideOfAccountType(ledger.account.accountType),
  }));
}

/**
 * General Ledger (Odoo-style) — every account (or the selected ones) with
 * opening balance, each dated Journal Entry line (journal, entry, source
 * document, partner, debit, credit, running balance) and closing balance.
 * Read from posted Journal Entries only (drafts via the Posted Only
 * toggle); totals cover every matched account and equal the Trial Balance.
 */
export function GeneralLedgerTab() {
  const { t } = useLocale();
  const openFullRecord = useOpenFullRecord();
  const { filters, setFilters, params } = useReportQuery();
  const [accounts, setAccounts] = useState<ChartOfAccountRow[]>([]);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<GeneralLedgerResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const accountIds = useMemo(() => accounts.map((account) => account.id), [accounts]);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setResult(
        await accountingReportsService.generalLedger({
          ...params,
          accountIds,
          page,
          pageSize: ACCOUNTS_PER_PAGE,
        }),
      );
    } catch (error) {
      reportApiError(error, "common.noResults");
    } finally {
      setIsLoading(false);
    }
  }, [params, accountIds, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const changeFilters = (next: ReportFilterValue) => {
    setPage(1);
    setFilters(next);
  };
  const changeAccounts = (next: ChartOfAccountRow[]) => {
    setPage(1);
    setAccounts(next);
  };

  const blocks = useMemo(() => toLedgerBlocks(result?.items ?? []), [result]);
  const lines = useMemo(() => blocks.map((block) => buildLedgerBlock(block, t)), [blocks, t]);

  // Print / Excel / CSV: every page of accounts with the same filters.
  const loadAllLines = useCallback(async () => {
    const items = await fetchAllReportPages(
      (nextPage) =>
        accountingReportsService.generalLedger({
          ...params,
          accountIds,
          page: nextPage,
          pageSize: ACCOUNTS_PER_PAGE,
        }),
      ACCOUNTS_PER_PAGE,
    );
    return toLedgerBlocks(items).map((block) => buildLedgerBlock(block, t));
  }, [params, accountIds, t]);
  const movementIndex = useMemo(() => indexLedgerMovements(blocks), [blocks]);
  const textColumns = useMemo(() => ledgerTextColumns(movementIndex), [movementIndex]);

  const totals = result?.totals ?? {
    openingBalance: 0,
    periodDebit: 0,
    periodCredit: 0,
    closingBalance: 0,
  };
  const total = result?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / ACCOUNTS_PER_PAGE));

  return (
    <FinancialReport
      lines={lines}
      columns={LEDGER_COLUMNS}
      textColumns={textColumns}
      nameHeaderKey="reports.finance.fields.account"
      // A handful of selected accounts open straight to their movements; the
      // full ledger starts collapsed to one row per account.
      defaultExpanded={accounts.length > 0 && blocks.length <= 3 ? "all" : "none"}
      exportAllLines
      loadAllLines={loadAllLines}
      isLoading={isLoading}
      filters={filters}
      onFiltersChange={changeFilters}
      toolbarExtra={
        <MultiEntityFilter
          label={t("reports.finance.ledger.accounts")}
          values={accounts}
          onChange={changeAccounts}
          onSearch={async (search) => {
            const found = await accountsService.list({ search: search || undefined, pageSize: 20 });
            return found.items;
          }}
          getId={(account) => account.id}
          getTitle={(account) => `${account.code} · ${account.name}`}
        />
      }
      printTitle={t("reports.finance.generalLedger")}
      exportFileName="general-ledger.xlsx"
      signConvention
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
      summary={
        result
          ? {
              // Period debits / credits are the figures that count (shown in
              // the reconciliation card); the net opening / closing of many
              // accounts is ~0 and stays in the footer.
              items: [],
              check: {
                balanced: result.balanced,
                difference: totals.periodDebit - totals.periodCredit,
                label: t("docFlow.reports.debitsEqualCredits"),
                scope: "period",
                // Selected accounts never balance on their own — say so.
                notApplicable:
                  accounts.length > 0 ? t("reports.finance.checkFilteredAccounts") : undefined,
                sides: [
                  {
                    id: "periodDebit",
                    label: t("reports.finance.fields.debitTotal"),
                    value: totals.periodDebit,
                  },
                  {
                    id: "periodCredit",
                    label: t("reports.finance.fields.creditTotal"),
                    value: totals.periodCredit,
                  },
                ],
                drillDown: {
                  href: financeReportHref("journalReport", filters),
                  label: t("reports.finance.reconciliation.viewPeriodEntries"),
                },
              },
            }
          : undefined
      }
      footer={{
        values: {
          debit: totals.periodDebit,
          credit: totals.periodCredit,
          balance: totals.closingBalance,
        },
      }}
      pagination={
        <ReportPagination
          rangeLabel={t("reports.finance.ledger.accountsRange", {
            from: (page - 1) * ACCOUNTS_PER_PAGE + 1,
            to: Math.min(page * ACCOUNTS_PER_PAGE, total),
            total,
          })}
          page={page}
          pageCount={pageCount}
          isLoading={isLoading}
          onPageChange={setPage}
        />
      }
    />
  );
}
