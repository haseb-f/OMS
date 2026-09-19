"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FinancialReport } from "@/components/accounting/financial-report";
import type { FinancialReportLine } from "@/components/accounting/financial-report";
import {
  accountingReportsService,
  type AgingPartnerRow,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { useReportQuery } from "./use-report-query";

export function AgingTab({ side }: { side: "AR" | "AP" }) {
  const { t } = useLocale();
  const { filters, setFilters, params } = useReportQuery();
  const [items, setItems] = useState<AgingPartnerRow[]>([]);
  const [totals, setTotals] = useState<AgingPartnerRow | null>(null);
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
        partnerId: "",
        partnerNumber: "",
        partnerName: t("reports.finance.totals"),
        current: result.totals.current,
        days31to60: result.totals.days31to60,
        days61to90: result.totals.days61to90,
        over90: result.totals.over90,
        total: result.totals.total,
      });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsLoading(false);
    }
  }, [params, side, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const lines = useMemo<FinancialReportLine[]>(() => {
    const partners: FinancialReportLine[] = items.map((item) => ({
      id: item.partnerId,
      parentId: "aging",
      kind: "posting",
      level: 1,
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
    }));
    return [
      {
        id: "aging",
        parentId: null,
        kind: "section",
        level: 0,
        label: side === "AR" ? t("reports.finance.arAging") : t("reports.finance.apAging"),
        expandable: partners.length > 0,
        values: {
          current: totals?.current ?? 0,
          days31to60: totals?.days31to60 ?? 0,
          days61to90: totals?.days61to90 ?? 0,
          over90: totals?.over90 ?? 0,
          total: totals?.total ?? 0,
        },
        children: partners,
      },
      {
        id: "aging-total",
        parentId: null,
        kind: "grand_total",
        level: 0,
        label: t("reports.finance.totals"),
        expandable: false,
        values: {
          current: totals?.current ?? 0,
          days31to60: totals?.days31to60 ?? 0,
          days61to90: totals?.days61to90 ?? 0,
          over90: totals?.over90 ?? 0,
          total: totals?.total ?? 0,
        },
        children: [],
      },
    ];
  }, [items, totals, side, t]);

  return (
    <FinancialReport
      lines={lines}
      columns={[
        { key: "current", labelKey: "reports.finance.aging.current" },
        { key: "days31to60", labelKey: "reports.finance.aging.days31to60" },
        { key: "days61to90", labelKey: "reports.finance.aging.days61to90" },
        { key: "over90", labelKey: "reports.finance.aging.over90" },
        { key: "total", labelKey: "reports.finance.fields.balance", emphasize: true },
      ]}
      isLoading={isLoading}
      filters={filters}
      onFiltersChange={setFilters}
      printTitle={side === "AR" ? t("reports.finance.arAging") : t("reports.finance.apAging")}
      exportFileName={`${side.toLowerCase()}-aging.csv`}
      nameHeaderKey="reports.finance.fields.partnerName"
    />
  );
}
