"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Landmark } from "lucide-react";
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
  type AccountLedger,
  type AccountLedgerMovement,
} from "@/services/accounting-reports-service";
import type { ChartOfAccountRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDate, toISODate } from "@/lib/date";
import { MoneyCell, toExportRows } from "./shared";

export function AccountStatementTab() {
  const { t } = useLocale();
  const [filters, setFilters] = useState<ReportFilterValue>(EMPTY_REPORT_FILTERS);
  const [account, setAccount] = useState<ChartOfAccountRow | null>(null);
  const [statement, setStatement] = useState<AccountLedger | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!account) {
      setStatement(null);
      return;
    }
    setIsLoading(true);
    try {
      const result = await accountingReportsService.accountStatement(account.id, {
        companyId: filters.companyId || undefined,
        branchId: filters.branchId || undefined,
        costCenterId: filters.costCenterId || undefined,
        projectId: filters.projectId || undefined,
        currencyId: filters.currencyId || undefined,
        dateFrom: filters.dateRange.from ? toISODate(filters.dateRange.from) : undefined,
        dateTo: filters.dateRange.to ? toISODate(filters.dateRange.to) : undefined,
        postedOnly: filters.postedOnly,
      });
      setStatement(result);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsLoading(false);
    }
  }, [account, filters, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns = useMemo<ColumnDef<AccountLedgerMovement, unknown>[]>(
    () => [
      {
        id: "entryDate",
        meta: { titleKey: "reports.finance.fields.entryDate" },
        accessorFn: (row) => formatDate(row.entryDate),
      },
      {
        id: "entryNumber",
        meta: { titleKey: "reports.finance.fields.entryNumber" },
        accessorFn: (row) => row.entryNumber,
        cell: (info) => (
          <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {info.getValue() as string}
          </code>
        ),
      },
      {
        id: "description",
        meta: { titleKey: "reports.finance.fields.description" },
        accessorFn: (row) => row.description ?? "—",
      },
      {
        id: "debit",
        meta: { titleKey: "reports.finance.fields.debit" },
        accessorFn: (row) => row.debit,
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
      {
        id: "credit",
        meta: { titleKey: "reports.finance.fields.credit" },
        accessorFn: (row) => row.credit,
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
      {
        id: "runningBalance",
        meta: { titleKey: "reports.finance.fields.runningBalance" },
        accessorFn: (row) => row.runningBalance,
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
    ],
    [],
  );

  const exportKeys = [
    "entryDate",
    "entryNumber",
    "description",
    "debit",
    "credit",
    "runningBalance",
  ];
  const movements = statement?.movements ?? [];

  return (
    <div className="flex flex-col gap-3">
      <AccountingReportFilterBar
        value={filters}
        onChange={setFilters}
        accountFilter={{ value: account, onChange: setAccount, required: true }}
      />

      {!account ? (
        <EmptyState
          icon={Landmark}
          title={t("reports.finance.accountStatement.selectAccountTitle")}
          description={t("reports.finance.accountStatement.selectAccountDescription")}
        />
      ) : (
        <>
          {statement && (
            <div className="flex flex-wrap items-center justify-end gap-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <span className="flex items-center gap-1">
                {t("reports.finance.fields.openingBalance")}{" "}
                <MoneyCell value={statement.openingBalance} />
              </span>
              <span className="flex items-center gap-1">
                {t("reports.finance.fields.debit")} <MoneyCell value={statement.periodDebit} />
              </span>
              <span className="flex items-center gap-1">
                {t("reports.finance.fields.credit")} <MoneyCell value={statement.periodCredit} />
              </span>
              <span className="flex items-center gap-1 font-medium">
                {t("reports.finance.fields.closingBalance")}{" "}
                <MoneyCell value={statement.closingBalance} />
              </span>
            </div>
          )}
          <EnterpriseDataTable
            tableId="reports-finance-account-statement"
            printTitle={t("reports.finance.accountStatement.title")}
            columns={columns}
            data={movements}
            isLoading={isLoading}
            getRowId={(row, index) => `${row.journalEntryId}-${index}`}
            exportColumns={exportColumnsFromKeys(columns, exportKeys, t)}
            onExport={(keys) =>
              exportRowsToCsv(toExportRows(columns, movements), keys, "account-statement.csv")
            }
          />
        </>
      )}
    </div>
  );
}
