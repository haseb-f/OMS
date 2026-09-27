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
  type AgingPartnerRow,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";
import { useReportQuery } from "./use-report-query";
import { partnerStatementHref } from "./report-url";

type AgingTotals = Pick<
  AgingPartnerRow,
  "current" | "days31to60" | "days61to90" | "over90" | "total"
>;

const EMPTY_TOTALS: AgingTotals = {
  current: 0,
  days31to60: 0,
  days61to90: 0,
  over90: 0,
  total: 0,
};

const BUCKETS: Array<{ key: keyof AgingTotals; labelKey: MessageKey }> = [
  { key: "current", labelKey: "reports.finance.aging.current" },
  { key: "days31to60", labelKey: "reports.finance.aging.days31to60" },
  { key: "days61to90", labelKey: "reports.finance.aging.days61to90" },
  { key: "over90", labelKey: "reports.finance.aging.over90" },
];

const COLUMNS: FinancialReportColumn[] = [
  ...BUCKETS.map((bucket) => ({ key: bucket.key, labelKey: bucket.labelKey })),
  { key: "total", labelKey: "reports.finance.fields.balance", emphasize: true },
];

/**
 * AR / AP Aging — one row per partner (drills into the partner statement for
 * the same scope), the totals once in the footer, and the buckets as the
 * summary strip.
 */
export function AgingTab({ side }: { side: "AR" | "AP" }) {
  const { t } = useLocale();
  const { filters, setFilters, params } = useReportQuery();
  const [items, setItems] = useState<AgingPartnerRow[]>([]);
  const [totals, setTotals] = useState<AgingTotals>(EMPTY_TOTALS);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result =
        side === "AR"
          ? await accountingReportsService.arAging(params)
          : await accountingReportsService.apAging(params);
      setItems(result.partners);
      setTotals({
        current: result.totals.current,
        days31to60: result.totals.days31to60,
        days61to90: result.totals.days61to90,
        over90: result.totals.over90,
        total: result.totals.total,
      });
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

  const lines = useMemo<FinancialReportLine[]>(
    () =>
      items.map((item) => ({
        id: item.partnerId,
        parentId: null,
        kind: "posting",
        level: 0,
        code: item.partnerNumber,
        label: item.partnerName,
        expandable: false,
        values: {
          current: item.current,
          days31to60: item.days31to60,
          days61to90: item.days61to90,
          over90: item.over90,
          total: item.total,
        },
        children: [],
      })),
    [items],
  );

  const summaryItems: FinancialReportSummaryItem[] = [
    ...BUCKETS.map((bucket) => ({
      id: bucket.key,
      label: t("reports.finance.aging.bucket", { range: t(bucket.labelKey) }),
      value: totals[bucket.key],
    })),
    {
      id: "total",
      label: t("reports.finance.fields.balance"),
      value: totals.total,
      emphasize: true,
    },
  ];

  const title = side === "AR" ? t("reports.finance.arAging") : t("reports.finance.apAging");

  return (
    <FinancialReport
      lines={lines}
      columns={COLUMNS}
      isLoading={isLoading}
      filters={filters}
      onFiltersChange={setFilters}
      rowHref={(line) =>
        partnerStatementHref(line.id, side === "AR" ? "CUSTOMER" : "SUPPLIER", filters)
      }
      printTitle={title}
      exportFileName={`${side.toLowerCase()}-aging.csv`}
      nameHeaderKey="reports.finance.fields.partnerName"
      summary={{ items: summaryItems }}
      footer={{ values: { ...totals } }}
    />
  );
}
