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
  type IncomeStatementResult,
  type StatementRow,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { toISODate } from "@/lib/date";
import { MoneyCell, toExportRows } from "./shared";

const EMPTY_RESULT: IncomeStatementResult = {
  revenue: [],
  expense: [],
  totals: { totalRevenue: 0, totalExpense: 0, netIncome: 0 },
};

export function IncomeStatementTab() {
  const { t } = useLocale();
  const [filters, setFilters] = useState<ReportFilterValue>(EMPTY_REPORT_FILTERS);
  const [result, setResult] = useState<IncomeStatementResult>(EMPTY_RESULT);
  const [isLoading, setIsLoading] = useState(true);

  const columns = useMemo<ColumnDef<StatementRow, unknown>[]>(
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
        id: "balance",
        meta: { titleKey: "reports.finance.fields.balance" },
        accessorFn: (row) => row.balance,
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
    ],
    [],
  );
  const exportKeys = ["accountCode", "accountName", "balance"];

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await accountingReportsService.incomeStatement({
        companyId: filters.companyId || undefined,
        branchId: filters.branchId || undefined,
        costCenterId: filters.costCenterId || undefined,
        projectId: filters.projectId || undefined,
        currencyId: filters.currencyId || undefined,
        dateFrom: filters.dateRange.from ? toISODate(filters.dateRange.from) : undefined,
        dateTo: filters.dateRange.to ? toISODate(filters.dateRange.to) : undefined,
        postedOnly: filters.postedOnly,
      });
      setResult(data);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsLoading(false);
    }
  }, [filters, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <AccountingReportFilterBar value={filters} onChange={setFilters} />

      <div className="flex flex-col gap-1.5">
        <h3 className="text-body font-semibold">{t("reports.finance.fields.revenue")}</h3>
        <EnterpriseDataTable
          tableId="reports-finance-income-statement-revenue"
          printTitle={t("reports.finance.fields.revenue")}
          columns={columns}
          data={result.revenue}
          isLoading={isLoading}
          getRowId={(row) => row.accountId}
          exportColumns={exportColumnsFromKeys(columns, exportKeys, t)}
          onExport={(keys) =>
            exportRowsToCsv(
              toExportRows(columns, result.revenue),
              keys,
              "income-statement-revenue.csv",
            )
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-body font-semibold">{t("reports.finance.fields.expense")}</h3>
        <EnterpriseDataTable
          tableId="reports-finance-income-statement-expense"
          printTitle={t("reports.finance.fields.expense")}
          columns={columns}
          data={result.expense}
          isLoading={isLoading}
          getRowId={(row) => row.accountId}
          exportColumns={exportColumnsFromKeys(columns, exportKeys, t)}
          onExport={(keys) =>
            exportRowsToCsv(
              toExportRows(columns, result.expense),
              keys,
              "income-statement-expense.csv",
            )
          }
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        <span className="flex items-center gap-1">
          {t("reports.finance.fields.totalRevenue")}{" "}
          <MoneyCell value={result.totals.totalRevenue} />
        </span>
        <span className="flex items-center gap-1">
          {t("reports.finance.fields.totalExpense")}{" "}
          <MoneyCell value={result.totals.totalExpense} />
        </span>
        <span className="flex items-center gap-1 font-medium">
          {t("reports.finance.fields.netIncome")}{" "}
          <span className={result.totals.netIncome >= 0 ? "text-success" : "text-destructive"}>
            <MoneyCell value={result.totals.netIncome} />
          </span>
        </span>
      </div>
    </div>
  );
}
