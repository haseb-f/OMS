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
  type CashFlowResult,
  type CashFlowMovement,
} from "@/services/accounting-reports-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { toISODate } from "@/lib/date";
import { MoneyCell, toExportRows } from "./shared";

const EMPTY_RESULT: CashFlowResult = {
  openingBalance: 0,
  movements: [],
  totals: { netCashChange: 0, closingBalance: 0 },
};

export function CashFlowTab() {
  const { t } = useLocale();
  const [filters, setFilters] = useState<ReportFilterValue>(EMPTY_REPORT_FILTERS);
  const [result, setResult] = useState<CashFlowResult>(EMPTY_RESULT);
  const [isLoading, setIsLoading] = useState(true);

  const columns = useMemo<ColumnDef<CashFlowMovement, unknown>[]>(
    () => [
      {
        id: "sourceType",
        meta: { titleKey: "reports.finance.fields.sourceType" },
        accessorFn: (row) => row.sourceType,
      },
      {
        id: "netChange",
        meta: { titleKey: "reports.finance.fields.netChange" },
        accessorFn: (row) => row.netChange,
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
    ],
    [],
  );
  const exportKeys = ["sourceType", "netChange"];

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await accountingReportsService.cashFlow({
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
      <p className="text-caption text-muted-foreground">{t("reports.finance.cashFlowHint")}</p>

      <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-caption">
        <span className="text-muted-foreground">{t("reports.finance.fields.openingBalance")}</span>
        <MoneyCell value={result.openingBalance} />
      </div>

      <EnterpriseDataTable
        filterBar={<AccountingReportFilterBar value={filters} onChange={setFilters} />}
        tableId="reports-finance-cash-flow"
        printTitle={t("reports.finance.cashFlow")}
        columns={columns}
        data={result.movements}
        isLoading={isLoading}
        getRowId={(row) => row.sourceType}
        exportColumns={exportColumnsFromKeys(columns, exportKeys, t)}
        onExport={(keys) =>
          exportRowsToCsv(toExportRows(columns, result.movements), keys, "cash-flow.csv")
        }
      />

      <div className="flex flex-wrap items-center justify-end gap-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        <span className="flex items-center gap-1">
          {t("reports.finance.fields.netChange")} <MoneyCell value={result.totals.netCashChange} />
        </span>
        <span className="flex items-center gap-1 font-medium">
          {t("reports.finance.fields.closingBalance")}{" "}
          <MoneyCell value={result.totals.closingBalance} />
        </span>
      </div>
    </div>
  );
}
