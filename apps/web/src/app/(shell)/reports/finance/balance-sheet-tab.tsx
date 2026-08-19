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
import { FilterSurface } from "@/components/shared/data-table/list-surface";
import {
  accountingReportsService,
  type BalanceSheetResult,
  type StatementRow,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { toISODate, formatDate } from "@/lib/date";
import { MoneyCell, toExportRows } from "./shared";

const EMPTY_RESULT: BalanceSheetResult = {
  asOfDate: new Date().toISOString(),
  assets: [],
  liabilities: [],
  equity: [],
  currentEarnings: 0,
  totals: { totalAssets: 0, totalLiabilities: 0, totalEquity: 0, balanced: true },
};

function useStatementColumns(): ColumnDef<StatementRow, unknown>[] {
  return useMemo(
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
}

export function BalanceSheetTab() {
  const { t } = useLocale();
  const [filters, setFilters] = useState<ReportFilterValue>(EMPTY_REPORT_FILTERS);
  const [result, setResult] = useState<BalanceSheetResult>(EMPTY_RESULT);
  const [isLoading, setIsLoading] = useState(true);
  const columns = useStatementColumns();
  const exportKeys = ["accountCode", "accountName", "balance"];

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await accountingReportsService.balanceSheet({
        companyId: filters.companyId || undefined,
        branchId: filters.branchId || undefined,
        costCenterId: filters.costCenterId || undefined,
        projectId: filters.projectId || undefined,
        currencyId: filters.currencyId || undefined,
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
      <FilterSurface>
        <AccountingReportFilterBar value={filters} onChange={setFilters} />
      </FilterSurface>

      <p className="text-caption text-muted-foreground">
        {t("reports.finance.asOfDate")}: <span dir="ltr">{formatDate(result.asOfDate)}</span>
      </p>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-body font-semibold">{t("reports.finance.fields.assets")}</h3>
        <EnterpriseDataTable
          tableId="reports-finance-balance-sheet-assets"
          printTitle={t("reports.finance.fields.assets")}
          columns={columns}
          data={result.assets}
          isLoading={isLoading}
          getRowId={(row) => row.accountId}
          exportColumns={exportColumnsFromKeys(columns, exportKeys, t)}
          onExport={(keys) =>
            exportRowsToCsv(toExportRows(columns, result.assets), keys, "balance-sheet-assets.csv")
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-body font-semibold">{t("reports.finance.fields.liabilities")}</h3>
        <EnterpriseDataTable
          tableId="reports-finance-balance-sheet-liabilities"
          printTitle={t("reports.finance.fields.liabilities")}
          columns={columns}
          data={result.liabilities}
          isLoading={isLoading}
          getRowId={(row) => row.accountId}
          exportColumns={exportColumnsFromKeys(columns, exportKeys, t)}
          onExport={(keys) =>
            exportRowsToCsv(
              toExportRows(columns, result.liabilities),
              keys,
              "balance-sheet-liabilities.csv",
            )
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-body font-semibold">{t("reports.finance.fields.equity")}</h3>
        <EnterpriseDataTable
          tableId="reports-finance-balance-sheet-equity"
          printTitle={t("reports.finance.fields.equity")}
          columns={columns}
          data={result.equity}
          isLoading={isLoading}
          getRowId={(row) => row.accountId}
          exportColumns={exportColumnsFromKeys(columns, exportKeys, t)}
          onExport={(keys) =>
            exportRowsToCsv(toExportRows(columns, result.equity), keys, "balance-sheet-equity.csv")
          }
        />
        <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2 text-caption">
          <span className="text-muted-foreground">
            {t("reports.finance.fields.currentEarnings")}
          </span>
          <MoneyCell value={result.currentEarnings} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        <span className="flex items-center gap-1">
          {t("reports.finance.fields.totalAssets")} <MoneyCell value={result.totals.totalAssets} />
        </span>
        <span className="flex items-center gap-1">
          {t("reports.finance.fields.totalLiabilities")}{" "}
          <MoneyCell value={result.totals.totalLiabilities} />
        </span>
        <span className="flex items-center gap-1">
          {t("reports.finance.fields.totalEquity")} <MoneyCell value={result.totals.totalEquity} />
        </span>
        <span
          className={
            result.totals.balanced ? "text-success font-medium" : "text-destructive font-medium"
          }
        >
          {result.totals.balanced ? t("reports.finance.balanced") : t("reports.finance.unbalanced")}
        </span>
      </div>
    </div>
  );
}
