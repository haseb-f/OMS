"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  accountingReportsService,
  type CashAvailabilityResult,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";
import { Info, TriangleAlert } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FinancialReport } from "@/components/accounting/financial-report";
import type { MessageKey } from "@/i18n/translate";
import type {
  FinancialReportColumn,
  FinancialReportLine,
  FinancialReportSummaryItem,
} from "@/components/accounting/financial-report";
import { useReportQuery } from "./use-report-query";

const COLUMNS: FinancialReportColumn[] = [
  // Cash is debit-natured: a figure below zero is adverse (red).
  {
    key: "bookBalance",
    labelKey: "reports.finance.cashAvailabilityReport.bookBalance",
    balance: "debit",
  },
  { key: "holds", labelKey: "reports.finance.cashAvailabilityReport.holds" },
  { key: "committed", labelKey: "reports.finance.cashAvailabilityReport.committed" },
  {
    key: "available",
    labelKey: "reports.finance.cashAvailabilityReport.available",
    emphasize: true,
    balance: "debit",
  },
  {
    key: "egpAvailable",
    labelKey: "reports.finance.cashAvailabilityReport.egpAvailable",
    balance: "debit",
  },
];

/**
 * The API states its formula and limitations as English prose. The known
 * ones are recognised by their leading term and shown from the dictionary;
 * only text the web layer does not know yet falls back to the API's own.
 */
const KNOWN_NOTES: Array<{ prefix: string; key: MessageKey }> = [
  { prefix: "availableToSpend =", key: "reports.finance.cashAvailabilityReport.formula" },
  {
    prefix: "recordedHolds",
    key: "reports.finance.cashAvailabilityReport.limitations.holdsNotTracked",
  },
  {
    prefix: "bankConfirmedAvailable",
    key: "reports.finance.cashAvailabilityReport.limitations.notBankConfirmed",
  },
  {
    prefix: "EGP equivalents",
    key: "reports.finance.cashAvailabilityReport.limitations.egpRates",
  },
];

function localizeCashAvailabilityNote(text: string, t: (key: MessageKey) => string): string {
  const known = KNOWN_NOTES.find((note) => text.trim().startsWith(note.prefix));
  return known ? t(known.key) : text;
}

/**
 * Cash & bank availability (an estimate) — one section per currency (its
 * accounts, then the currency total), the EGP consolidated figure as the
 * grand total. Only the filters the API reads (as-of date, currency) are
 * shown. Amounts are stated per currency (never summed across currencies);
 * the EGP column is the converted equivalent where a rate exists.
 */
export function CashAvailabilityTab() {
  const { t } = useLocale();
  const { filters, setFilters, params } = useReportQuery();
  const [result, setResult] = useState<CashAvailabilityResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setResult(
        await accountingReportsService.cashAvailability({
          asOf: params.dateTo,
          currencyId: params.currencyId,
        }),
      );
    } catch (error) {
      reportApiError(error, "common.noResults");
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [params.currencyId, params.dateTo]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const lines = useMemo<FinancialReportLine[]>(() => {
    if (!result || result.accounts.length === 0) return [];
    const currencies = [
      ...new Set([
        ...result.totalsByCurrency.map((total) => total.currencyCode),
        ...result.accounts.map((row) => row.currencyCode),
      ]),
    ];
    const sections = currencies.map((currencyCode): FinancialReportLine => {
      const sectionId = `ccy:${currencyCode}`;
      const total = result.totalsByCurrency.find((row) => row.currencyCode === currencyCode);
      const accounts = result.accounts
        .filter((row) => row.currencyCode === currencyCode)
        .map((row): FinancialReportLine => ({
          id: `${sectionId}:${row.receivingAccountId}`,
          parentId: sectionId,
          kind: "posting",
          level: 1,
          code: row.accountCode,
          label: row.accountName,
          expandable: false,
          values: {
            bookBalance: row.bookBalance,
            holds: row.recordedHolds,
            committed: row.committedOutgoing,
            available: row.availableToSpend,
            ...(row.egpEquivalent.availableToSpend == null
              ? {}
              : { egpAvailable: row.egpEquivalent.availableToSpend }),
          },
          children: [],
        }));
      const totalValues: Record<string, number> = total
        ? { bookBalance: total.book, available: total.available }
        : {};
      const totalLabel = t("reports.finance.cashAvailabilityReport.currencyTotal", {
        currency: currencyCode,
      });
      return {
        id: sectionId,
        parentId: null,
        kind: "section",
        level: 0,
        label: currencyCode,
        expandable: accounts.length > 0,
        values: totalValues,
        children: [
          ...accounts,
          {
            id: `${sectionId}:total`,
            parentId: sectionId,
            kind: "section_total",
            level: 1,
            label: totalLabel,
            labelEn: totalLabel,
            expandable: false,
            values: totalValues,
            children: [],
          },
        ],
      };
    });
    const grandLabel = t("reports.finance.cashAvailabilityReport.egpConsolidated");
    return [
      ...sections,
      {
        id: "cash-egp-consolidated",
        parentId: null,
        kind: "grand_total",
        level: 0,
        label: grandLabel,
        labelEn: grandLabel,
        expandable: false,
        values: { egpAvailable: result.egpConsolidated.availableToSpend },
        children: [],
      },
    ];
  }, [result, t]);

  const summaryItems: FinancialReportSummaryItem[] = result
    ? [
        ...result.totalsByCurrency.map((total) => ({
          id: `available:${total.currencyCode}`,
          label: t("reports.finance.cashAvailabilityReport.available"),
          value: total.available,
          currency: total.currencyCode,
        })),
        {
          id: "egpConsolidated",
          label: t("reports.finance.cashAvailabilityReport.egpConsolidated"),
          value: result.egpConsolidated.availableToSpend,
          currency: "EGP",
          emphasize: true,
        },
      ]
    : [];

  return (
    <FinancialReport
      lines={lines}
      columns={COLUMNS}
      isLoading={isLoading}
      filters={filters}
      onFiltersChange={setFilters}
      filterFields={["currency", "asOf"]}
      // Mixed currencies: each section / tile names its own currency.
      currency=""
      defaultExpanded="all"
      printTitle={t("reports.finance.cashAvailability")}
      exportFileName="cash-availability.xlsx"
      summary={result ? { items: summaryItems } : undefined}
      // The estimate caveat stays visible on the collapsed header (spec-4 §4A).
      alerts={[t("reports.finance.cashAvailabilityReport.estimateBadge")]}
      notice={
        // One caption line: the estimate caveat up front, the formula and the
        // limitations one click away (progressive disclosure).
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-1.5 font-medium text-warning-soft-foreground">
            <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
            {t("reports.finance.cashAvailabilityReport.estimateBadge")}
          </span>
          {result ? (
            <Popover>
              <PopoverTrigger asChild>
                <EnterpriseButton
                  type="button"
                  variant="link"
                  size="inline"
                  className="text-caption"
                >
                  <Info aria-hidden />
                  {t("reports.finance.header.estimateDetails")}
                </EnterpriseButton>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)]">
                <ul className="flex list-disc flex-col gap-1.5 ps-4 text-caption text-muted-foreground">
                  {[result.formula, ...result.limitations].filter(Boolean).map((note) => (
                    <li key={note}>{localizeCashAvailabilityNote(note, t)}</li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          ) : null}
        </span>
      }
    />
  );
}
