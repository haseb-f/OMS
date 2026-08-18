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
  type TrialBalanceRow,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { toISODate } from "@/lib/date";
import { MoneyCell, toExportRows } from "./shared";

export function TrialBalanceTab() {
  const { t } = useLocale();
  const [filters, setFilters] = useState<ReportFilterValue>(EMPTY_REPORT_FILTERS);
  const [items, setItems] = useState<TrialBalanceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState({ debitTotal: 0, creditTotal: 0 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await accountingReportsService.trialBalance({
        companyId: filters.companyId || undefined,
        branchId: filters.branchId || undefined,
        costCenterId: filters.costCenterId || undefined,
        projectId: filters.projectId || undefined,
        currencyId: filters.currencyId || undefined,
        dateFrom: filters.dateRange.from ? toISODate(filters.dateRange.from) : undefined,
        dateTo: filters.dateRange.to ? toISODate(filters.dateRange.to) : undefined,
        postedOnly: filters.postedOnly,
        page,
        pageSize,
      });
      setItems(result.items);
      setTotal(result.total);
      setTotals(result.totals);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsLoading(false);
    }
  }, [filters, page, pageSize, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns = useMemo<ColumnDef<TrialBalanceRow, unknown>[]>(
    () => [
      {
        id: "accountCode",
        meta: { titleKey: "reports.finance.fields.accountCode" },
        accessorFn: (row) => row.accountCode,
      },
      {
        id: "accountName",
        meta: { titleKey: "reports.finance.fields.accountName" },
        accessorFn: (row) => row.accountName,
      },
      {
        id: "debitTotal",
        meta: { titleKey: "reports.finance.fields.debitTotal" },
        accessorFn: (row) => row.debitTotal,
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
      {
        id: "creditTotal",
        meta: { titleKey: "reports.finance.fields.creditTotal" },
        accessorFn: (row) => row.creditTotal,
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
      {
        id: "balance",
        meta: { titleKey: "reports.finance.fields.balance" },
        accessorFn: (row) => row.balance,
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
    ],
    [],
  );

  const exportKeys = ["accountCode", "accountName", "debitTotal", "creditTotal", "balance"];
  const isBalanced = Math.abs(totals.debitTotal - totals.creditTotal) < 0.01;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        <span className="text-muted-foreground">{t("reports.finance.totals")}:</span>
        <span className="flex items-center gap-1">
          {t("reports.finance.fields.debitTotal")} <MoneyCell value={totals.debitTotal} />
        </span>
        <span className="flex items-center gap-1">
          {t("reports.finance.fields.creditTotal")} <MoneyCell value={totals.creditTotal} />
        </span>
        <span className={isBalanced ? "text-success font-medium" : "text-destructive font-medium"}>
          {isBalanced ? t("reports.finance.balanced") : t("reports.finance.unbalanced")}
        </span>
      </div>

      <EnterpriseDataTable
        filterBar={
          <AccountingReportFilterBar
            value={filters}
            onChange={(next) => {
              setFilters(next);
              setPage(1);
            }}
          />
        }
        tableId="reports-finance-trial-balance"
        printTitle={t("reports.finance.trialBalance")}
        columns={columns}
        data={items}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        isLoading={isLoading}
        getRowId={(row) => row.accountId}
        exportColumns={exportColumnsFromKeys(columns, exportKeys, t)}
        onExport={(keys) =>
          exportRowsToCsv(toExportRows(columns, items), keys, "trial-balance.csv")
        }
      />
    </div>
  );
}
