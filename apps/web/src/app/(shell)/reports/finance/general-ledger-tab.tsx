"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { FinancialReport } from "@/components/accounting/financial-report";
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
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { buildLedgerBlock, indexLedgerMovements, ledgerTextColumns } from "./ledger-lines";
import { useReportQuery } from "./use-report-query";

const accountsService = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");

/** Accounts per page — each carries its full movement list for the period. */
const ACCOUNTS_PER_PAGE = 100;

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
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsLoading(false);
    }
  }, [params, accountIds, page, t]);

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

  const blocks = useMemo(
    () =>
      (result?.items ?? []).map((ledger) => ({
        id: `account:${ledger.account.id}`,
        code: ledger.account.code,
        label: ledger.account.name,
        labelEn: ledger.account.nameEn,
        openingBalance: ledger.openingBalance,
        periodDebit: ledger.periodDebit,
        periodCredit: ledger.periodCredit,
        closingBalance: ledger.closingBalance,
        movements: ledger.movements,
      })),
    [result],
  );
  const lines = useMemo(() => blocks.map((block) => buildLedgerBlock(block, t)), [blocks, t]);
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
      columns={[
        { key: "debit", labelKey: "reports.finance.fields.debit" },
        { key: "credit", labelKey: "reports.finance.fields.credit" },
        { key: "balance", labelKey: "reports.finance.fields.runningBalance", emphasize: true },
      ]}
      textColumns={textColumns}
      nameHeaderKey="reports.finance.fields.account"
      // A handful of selected accounts open straight to their movements; the
      // full ledger starts collapsed to one row per account.
      defaultExpanded={accounts.length > 0 && blocks.length <= 3 ? "all" : "none"}
      exportAllLines
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
              items: [
                { label: t("reports.finance.fields.openingBalance"), value: totals.openingBalance },
                { label: t("reports.finance.fields.debit"), value: totals.periodDebit },
                { label: t("reports.finance.fields.credit"), value: totals.periodCredit },
                {
                  label: t("reports.finance.fields.closingBalance"),
                  value: totals.closingBalance,
                  emphasize: true,
                },
              ],
              check:
                accounts.length === 0
                  ? {
                      balanced: result.balanced,
                      difference: totals.periodDebit - totals.periodCredit,
                      label: t("docFlow.reports.debitsEqualCredits"),
                    }
                  : undefined,
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
        pageCount > 1 ? (
          <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2 text-caption text-muted-foreground">
            <span>
              {t("reports.finance.ledger.accountsRange", {
                from: (page - 1) * ACCOUNTS_PER_PAGE + 1,
                to: Math.min(page * ACCOUNTS_PER_PAGE, total),
                total,
              })}
            </span>
            <EnterpriseButton
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((current) => current - 1)}
              aria-label={t("common.previous")}
            >
              <ChevronRight className="size-3.5 ltr:rotate-180" />
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              size="sm"
              variant="outline"
              disabled={page >= pageCount || isLoading}
              onClick={() => setPage((current) => current + 1)}
              aria-label={t("common.next")}
            >
              <ChevronLeft className="size-3.5 ltr:rotate-180" />
            </EnterpriseButton>
          </div>
        ) : null
      }
    />
  );
}
