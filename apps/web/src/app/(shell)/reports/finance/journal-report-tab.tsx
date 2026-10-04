"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, ScrollText } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import {
  FinancialReport,
  FinancialReportView,
  ReportPagination,
  fetchAllReportPages,
  lineSideValues,
} from "@/components/accounting/financial-report";
import type {
  FinancialReportColumn,
  FinancialReportLine,
  FinancialReportTextColumn,
} from "@/components/accounting/financial-report";
import {
  accountingReportsService,
  type JournalReportEntry,
} from "@/services/accounting-reports-service";
import { journalSourceLabelKey } from "@/config/accounting/journal-source";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";
import { formatBusinessDate } from "@/components/accounting/financial-report/business-date";
import type { ReportFilterValue } from "@/components/accounting/report-filter-bar";
import { isZeroAmount } from "@/lib/money";
import { useReportQuery } from "./use-report-query";
import { financeReportHref } from "./report-url";

/** Entries per page — the range label always states which slice is shown. */
const ENTRIES_PER_PAGE = 100;

const COLUMNS: FinancialReportColumn[] = [
  { key: "debit", labelKey: "reports.finance.fields.debit" },
  { key: "credit", labelKey: "reports.finance.fields.credit" },
];

const TEXT_COLUMNS: FinancialReportTextColumn[] = [
  { key: "date", labelKey: "reports.finance.fields.entryDate", width: 6.5 },
  { key: "source", labelKey: "reports.finance.fields.sourceType", width: 11, hideBelow: "md" },
];

const NO_EXPANSION = new Set<string>();

export function JournalReportTab() {
  const { t } = useLocale();
  const router = useRouter();
  const { filters, setFilters, params } = useReportQuery();
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<JournalReportEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [detail, setDetail] = useState<JournalReportEntry | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await accountingReportsService.journalReport({
        ...params,
        page,
        pageSize: ENTRIES_PER_PAGE,
        sortOrder: "desc",
      });
      setItems(result.items);
      setTotal(result.total ?? result.items.length);
    } catch (error) {
      reportApiError(error, "common.noResults");
    } finally {
      setIsLoading(false);
    }
  }, [params, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const changeFilters = (next: ReportFilterValue) => {
    setPage(1);
    setFilters(next);
  };

  const toLines = useCallback(
    (entries: JournalReportEntry[]): FinancialReportLine[] =>
      entries.map((entry) => {
        const source = t(journalSourceLabelKey(entry.sourceType));
        return {
          id: entry.id,
          parentId: null,
          kind: "posting",
          level: 0,
          code: entry.entryNumber,
          label: entry.description || source,
          expandable: false,
          values: {
            debit: Number(entry.totalDebit),
            credit: Number(entry.totalCredit),
          },
          text: {
            date: formatBusinessDate(entry.entryDate),
            source: entry.referenceNumber ? `${source} ${entry.referenceNumber}` : source,
          },
          children: [],
        };
      }),
    [t],
  );
  const lines = useMemo(() => toLines(items), [items, toLines]);

  // Print / Excel / CSV: every entry of the period, not just this page.
  const loadAllLines = useCallback(async () => {
    const all = await fetchAllReportPages(
      (nextPage) =>
        accountingReportsService.journalReport({
          ...params,
          page: nextPage,
          pageSize: ENTRIES_PER_PAGE,
          sortOrder: "desc",
        }),
      ENTRIES_PER_PAGE,
    );
    return toLines(all);
  }, [params, toLines]);

  const detailLines = useMemo<FinancialReportLine[]>(
    () =>
      (detail?.lines ?? []).map((line) => ({
        id: line.id,
        parentId: null,
        kind: "posting",
        level: 0,
        code: line.account.code,
        label: line.account.name,
        expandable: false,
        // One JE line uses one side; the other is not applicable (blank).
        values: lineSideValues(line.debit, line.credit),
        text: { description: line.description ?? "" },
        children: [],
      })),
    [detail],
  );

  const pageCount = Math.max(1, Math.ceil(total / ENTRIES_PER_PAGE));

  // Debits = credits over the entries shown (this page). Every figure is the
  // API's own entry total; only their sum is new.
  const pageTotals = useMemo(
    () =>
      items.reduce(
        (sum, entry) => ({
          debit: sum.debit + Number(entry.totalDebit),
          credit: sum.credit + Number(entry.totalCredit),
        }),
        { debit: 0, credit: 0 },
      ),
    [items],
  );

  return (
    <>
      <FinancialReport
        lines={lines}
        columns={COLUMNS}
        textColumns={TEXT_COLUMNS}
        loadAllLines={loadAllLines}
        isLoading={isLoading}
        filters={filters}
        onFiltersChange={changeFilters}
        printTitle={t("reports.finance.journalReport")}
        exportFileName="journal-report.csv"
        nameHeaderKey="reports.finance.fields.description"
        summary={
          items.length > 0
            ? {
                items: [],
                check: {
                  balanced: isZeroAmount(pageTotals.debit - pageTotals.credit),
                  difference: pageTotals.debit - pageTotals.credit,
                  label: t("docFlow.reports.debitsEqualCredits"),
                  scope: "page",
                  sides: [
                    {
                      id: "pageDebit",
                      label: t("reports.finance.fields.debitTotal"),
                      value: pageTotals.debit,
                    },
                    {
                      id: "pageCredit",
                      label: t("reports.finance.fields.creditTotal"),
                      value: pageTotals.credit,
                    },
                  ],
                  drillDown: {
                    href: financeReportHref("trialBalance", filters),
                    label: t("reports.finance.reconciliation.viewTrialBalance"),
                  },
                },
              }
            : undefined
        }
        onPostingClick={(line) => {
          const match = items.find((entry) => entry.id === line.id);
          if (match) setDetail(match);
        }}
        pagination={
          <ReportPagination
            rangeLabel={t("reports.finance.journal.entriesRange", {
              from: (page - 1) * ENTRIES_PER_PAGE + 1,
              to: Math.min(page * ENTRIES_PER_PAGE, total),
              total,
            })}
            page={page}
            pageCount={pageCount}
            isLoading={isLoading}
            onPageChange={setPage}
          />
        }
      />

      <EnterpriseModal
        open={!!detail}
        onOpenChange={(open) => !open && setDetail(null)}
        icon={ScrollText}
        title={detail ? detail.entryNumber : ""}
        size="lg"
        footer={(requestClose) => (
          <>
            {detail ? (
              <EnterpriseButton
                type="button"
                variant="outline"
                onClick={() => router.push(`/finance/journal-entries/${detail.id}`)}
              >
                <Eye />
                {t("common.view")}
              </EnterpriseButton>
            ) : null}
            <EnterpriseButton type="button" variant="outline" onClick={requestClose}>
              {t("common.close")}
            </EnterpriseButton>
          </>
        )}
      >
        {detail ? (
          <div className="overflow-hidden rounded-md border border-border">
            <FinancialReportView
              lines={detailLines}
              columns={COLUMNS}
              textColumns={[
                {
                  key: "description",
                  labelKey: "reports.finance.fields.description",
                  width: 12,
                  hideBelow: "md",
                },
              ]}
              expanded={NO_EXPANSION}
              onToggle={() => undefined}
              emptyLabel={t("common.noResults")}
              nameHeaderKey="reports.finance.fields.account"
              footer={{
                values: { debit: Number(detail.totalDebit), credit: Number(detail.totalCredit) },
              }}
              maxHeightClassName="max-h-96"
            />
          </div>
        ) : null}
      </EnterpriseModal>
    </>
  );
}
