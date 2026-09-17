"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import {
  AccountingReportFilterBar,
  EMPTY_REPORT_FILTERS,
  type ReportFilterValue,
} from "@/components/accounting/report-filter-bar";
import {
  accountingReportsService,
  type AgingPartnerRow,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { toISODate } from "@/lib/date";
import { MoneyCell, toExportRows } from "./shared";

export function AgingTab({ side }: { side: "AR" | "AP" }) {
  const { t } = useLocale();
  const [filters, setFilters] = useState<ReportFilterValue>(EMPTY_REPORT_FILTERS);
  const [items, setItems] = useState<AgingPartnerRow[]>([]);
  const [totals, setTotals] = useState<AgingPartnerRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = {
        companyId: filters.companyId || undefined,
        branchId: filters.branchId || undefined,
        currencyId: filters.currencyId || undefined,
        dateTo: filters.dateRange.to ? toISODate(filters.dateRange.to) : undefined,
      };
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
  }, [filters, side, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo<ColumnDef<AgingPartnerRow, unknown>[]>(
    () => [
      {
        id: "partnerNumber",
        meta: { titleKey: "reports.finance.fields.partnerNumber" },
        accessorFn: (row) => row.partnerNumber,
      },
      {
        id: "partnerName",
        meta: { titleKey: "reports.finance.fields.partnerName" },
        accessorFn: (row) => row.partnerName,
      },
      {
        id: "current",
        meta: { titleKey: "reports.finance.aging.current" },
        accessorFn: (row) => row.current,
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
      {
        id: "days31to60",
        meta: { titleKey: "reports.finance.aging.days31to60" },
        accessorFn: (row) => row.days31to60,
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
      {
        id: "days61to90",
        meta: { titleKey: "reports.finance.aging.days61to90" },
        accessorFn: (row) => row.days61to90,
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
      {
        id: "over90",
        meta: { titleKey: "reports.finance.aging.over90" },
        accessorFn: (row) => row.over90,
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
      {
        id: "total",
        meta: { titleKey: "reports.finance.fields.balance" },
        accessorFn: (row) => row.total,
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
    ],
    [],
  );

  const exportKeys = [
    "partnerNumber",
    "partnerName",
    "current",
    "days31to60",
    "days61to90",
    "over90",
    "total",
  ];

  return (
    <EnterpriseDataTable
      filterBar={
        <AccountingReportFilterBar value={filters} onChange={(next) => setFilters(next)} />
      }
      tableId={`reports-finance-${side.toLowerCase()}-aging`}
      printTitle={side === "AR" ? t("reports.finance.arAging") : t("reports.finance.apAging")}
      columns={columns}
      data={items}
      totalCount={items.length}
      isLoading={isLoading}
      getRowId={(row) => row.partnerId}
      exportColumns={exportColumnsFromKeys(columns, exportKeys, t)}
      onExport={(keys) =>
        exportRowsToCsv(
          toExportRows(columns, totals ? [...items, totals] : items),
          keys,
          `${side.toLowerCase()}-aging.csv`,
        )
      }
    />
  );
}
