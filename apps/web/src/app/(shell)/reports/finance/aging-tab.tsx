"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FinancialReport } from "@/components/accounting/financial-report";
import type {
  FinancialReportColumn,
  FinancialReportLine,
  FinancialReportSummaryItem,
} from "@/components/accounting/financial-report";
import {
  accountingReportsService,
  type AgingCurrencyTotals,
  type AgingPartnerRow,
  type AgingResult,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";
import { useReportQuery } from "./use-report-query";
import { partnerStatementHref } from "./report-url";
import { useDataChanged } from "@/hooks/use-data-changed";

type AgingTotals = Pick<
  AgingPartnerRow,
  "current" | "days31to60" | "days61to90" | "over90" | "total" | "unapplied" | "net"
>;

const BUCKETS: Array<{ key: keyof AgingTotals; labelKey: MessageKey }> = [
  { key: "current", labelKey: "reports.finance.aging.current" },
  { key: "days31to60", labelKey: "reports.finance.aging.days31to60" },
  { key: "days61to90", labelKey: "reports.finance.aging.days61to90" },
  { key: "over90", labelKey: "reports.finance.aging.over90" },
];

const COLUMNS: FinancialReportColumn[] = [
  ...BUCKETS.map((bucket) => ({ key: bucket.key, labelKey: bucket.labelKey })),
  { key: "total", labelKey: "reports.finance.aging.openInvoices" },
  // R18 — credits standing against the open invoices; net = what the partner statement shows.
  { key: "unapplied", labelKey: "reports.finance.aging.unapplied" },
  { key: "net", labelKey: "reports.finance.aging.net", emphasize: true },
];

/** Line ids carry the currency: one partner can owe in several (R22 A1). */
const LINE_SEPARATOR = "|";

/**
 * The per-currency totals of an aging result: `totalsByCurrency` (R22 A1),
 * else — an API before it — the single `totals` row in its named currency.
 */
export function agingCurrencyTotals(result: AgingResult): AgingCurrencyTotals[] {
  if (result.totalsByCurrency && result.totalsByCurrency.length > 0) return result.totalsByCurrency;
  const totals = result.totals;
  return [
    {
      currencyId: result.totalsCurrencyId ?? null,
      currencyCode: result.totalsCurrencyCode ?? null,
      current: totals.current,
      days31to60: totals.days31to60,
      days61to90: totals.days61to90,
      over90: totals.over90,
      total: totals.total,
      unapplied: totals.unapplied ?? 0,
      net: totals.net ?? totals.total,
    },
  ];
}

/**
 * AR / AP Aging — one row per partner and currency (drills into the partner
 * statement for the same scope). R22 A1: amounts are never added across
 * currencies — with one currency the totals sit once in the footer and the
 * buckets in the summary strip; with several, each currency gets its own
 * open / unapplied / net summary tiles and rows name their currency.
 */
export function AgingTab({ side }: { side: "AR" | "AP" }) {
  const { t } = useLocale();
  const { filters, setFilters, params } = useReportQuery();
  const [items, setItems] = useState<AgingPartnerRow[]>([]);
  const [currencies, setCurrencies] = useState<AgingCurrencyTotals[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result =
        side === "AR"
          ? await accountingReportsService.arAging(params)
          : await accountingReportsService.apAging(params);
      setItems(result.partners);
      setCurrencies(agingCurrencyTotals(result));
    } catch (error) {
      reportApiError(error, "common.noResults");
    } finally {
      setIsLoading(false);
    }
  }, [params, side]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  // R22 §5 — paid / remaining figures refresh after any money operation (here or in another tab) and on return.
  useDataChanged("settlement", load);

  const multiCurrency = currencies.length > 1;
  const single = currencies.length === 1 ? currencies[0] : null;

  const lines = useMemo<FinancialReportLine[]>(
    () =>
      items.map((item) => ({
        id: `${item.partnerId}${LINE_SEPARATOR}${item.currencyId ?? ""}`,
        parentId: null,
        kind: "posting",
        level: 0,
        code: item.partnerNumber,
        label:
          multiCurrency && item.currencyCode
            ? `${item.partnerName} · ${item.currencyCode}`
            : item.partnerName,
        expandable: false,
        values: {
          current: item.current,
          days31to60: item.days31to60,
          days61to90: item.days61to90,
          over90: item.over90,
          total: item.total,
          unapplied: -(item.unapplied ?? 0),
          net: item.net ?? item.total,
        },
        children: [],
      })),
    [items, multiCurrency],
  );

  const summaryItems: FinancialReportSummaryItem[] = single
    ? [
        ...BUCKETS.map((bucket) => ({
          id: bucket.key,
          label: t("reports.finance.aging.bucket", { range: t(bucket.labelKey) }),
          value: single[bucket.key],
        })),
        { id: "total", label: t("reports.finance.aging.openInvoices"), value: single.total },
        {
          id: "unapplied",
          label: t("reports.finance.aging.unapplied"),
          value: -single.unapplied,
        },
        { id: "net", label: t("reports.finance.aging.net"), value: single.net, emphasize: true },
      ]
    : currencies.flatMap((totals) => {
        const code = totals.currencyCode ?? "";
        return [
          {
            id: `total-${code}`,
            label: `${t("reports.finance.aging.openInvoices")} · ${code}`,
            value: totals.total,
            currency: code,
          },
          {
            id: `net-${code}`,
            label: `${t("reports.finance.aging.net")} · ${code}`,
            value: totals.net,
            currency: code,
            emphasize: true,
          },
        ];
      });

  const title = side === "AR" ? t("reports.finance.arAging") : t("reports.finance.apAging");

  return (
    <FinancialReport
      lines={lines}
      columns={COLUMNS}
      isLoading={isLoading}
      filters={filters}
      onFiltersChange={setFilters}
      rowHref={(line) =>
        partnerStatementHref(
          line.id.split(LINE_SEPARATOR)[0],
          side === "AR" ? "CUSTOMER" : "SUPPLIER",
          filters,
        )
      }
      printTitle={title}
      exportFileName={`${side.toLowerCase()}-aging.csv`}
      nameHeaderKey="reports.finance.fields.partnerName"
      // One currency: the figures are stated in it; several: the header says "multi-currency".
      currency={multiCurrency ? "" : (single?.currencyCode ?? undefined)}
      summary={{ items: summaryItems }}
      footer={
        single
          ? {
              values: {
                current: single.current,
                days31to60: single.days31to60,
                days61to90: single.days61to90,
                over90: single.over90,
                total: single.total,
                unapplied: -single.unapplied,
                net: single.net,
              },
            }
          : undefined
      }
    />
  );
}
