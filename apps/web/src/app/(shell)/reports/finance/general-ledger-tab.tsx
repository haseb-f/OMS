"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye, ScrollText } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
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
} from "@/services/accounting-reports-service";
import type { ChartOfAccountRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDate, toISODate } from "@/lib/date";
import { MoneyCell, toExportRows } from "./shared";

export function GeneralLedgerTab() {
  const { t } = useLocale();
  const [filters, setFilters] = useState<ReportFilterValue>(EMPTY_REPORT_FILTERS);
  const [account, setAccount] = useState<ChartOfAccountRow | null>(null);
  const [items, setItems] = useState<AccountLedger[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [isLoading, setIsLoading] = useState(true);
  const [detail, setDetail] = useState<AccountLedger | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await accountingReportsService.generalLedger({
        accountId: account?.id,
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
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsLoading(false);
    }
  }, [account, filters, page, pageSize, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns = useMemo<ColumnDef<AccountLedger, unknown>[]>(
    () => [
      {
        id: "accountCode",
        meta: { titleKey: "reports.finance.fields.accountCode" },
        accessorFn: (row) => row.account.code,
      },
      {
        id: "accountName",
        meta: { titleKey: "reports.finance.fields.accountName" },
        accessorFn: (row) => row.account.name,
      },
      {
        id: "openingBalance",
        meta: { titleKey: "reports.finance.fields.openingBalance" },
        accessorFn: (row) => row.openingBalance,
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
      {
        id: "periodDebit",
        meta: { titleKey: "reports.finance.fields.debit" },
        accessorFn: (row) => row.periodDebit,
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
      {
        id: "periodCredit",
        meta: { titleKey: "reports.finance.fields.credit" },
        accessorFn: (row) => row.periodCredit,
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
      {
        id: "closingBalance",
        meta: { titleKey: "reports.finance.fields.closingBalance" },
        accessorFn: (row) => row.closingBalance,
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
      {
        id: "__actions",
        meta: { titleKey: "common.actions" },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <EnterpriseButton
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("reports.finance.viewMovements")}
            onClick={() => setDetail(row.original)}
          >
            <Eye className="size-4" />
          </EnterpriseButton>
        ),
      },
    ],
    [t],
  );

  const exportKeys = [
    "accountCode",
    "accountName",
    "openingBalance",
    "periodDebit",
    "periodCredit",
    "closingBalance",
  ];

  return (
    <>
      <EnterpriseDataTable
        filterBar={
          <AccountingReportFilterBar
            value={filters}
            onChange={(next) => {
              setFilters(next);
              setPage(1);
            }}
            accountFilter={{
              value: account,
              onChange: (a) => {
                setAccount(a);
                setPage(1);
              },
            }}
          />
        }
        tableId="reports-finance-general-ledger"
        printTitle={t("reports.finance.generalLedger")}
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
        getRowId={(row) => row.account.id}
        exportColumns={exportColumnsFromKeys(columns, exportKeys, t)}
        onExport={(keys) =>
          exportRowsToCsv(toExportRows(columns, items), keys, "general-ledger.csv")
        }
      />

      <EnterpriseModal
        open={!!detail}
        onOpenChange={(open) => !open && setDetail(null)}
        icon={ScrollText}
        title={detail ? `${detail.account.code} — ${detail.account.name}` : ""}
        size="lg"
        footer={(requestClose) => (
          <EnterpriseButton type="button" variant="outline" onClick={requestClose}>
            {t("common.close")}
          </EnterpriseButton>
        )}
      >
        {detail && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>
                <div className="text-muted-foreground">
                  {t("reports.finance.fields.openingBalance")}
                </div>
                <MoneyCell value={detail.openingBalance} />
              </div>
              <div>
                <div className="text-muted-foreground">{t("reports.finance.fields.debit")}</div>
                <MoneyCell value={detail.periodDebit} />
              </div>
              <div>
                <div className="text-muted-foreground">{t("reports.finance.fields.credit")}</div>
                <MoneyCell value={detail.periodCredit} />
              </div>
              <div>
                <div className="text-muted-foreground">
                  {t("reports.finance.fields.closingBalance")}
                </div>
                <MoneyCell value={detail.closingBalance} />
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-start">
                  <tr>
                    <th className="p-2 text-start font-medium">
                      {t("reports.finance.fields.entryDate")}
                    </th>
                    <th className="p-2 text-start font-medium">
                      {t("reports.finance.fields.entryNumber")}
                    </th>
                    <th className="p-2 text-start font-medium">
                      {t("reports.finance.fields.description")}
                    </th>
                    <th className="p-2 text-end font-medium">
                      {t("reports.finance.fields.debit")}
                    </th>
                    <th className="p-2 text-end font-medium">
                      {t("reports.finance.fields.credit")}
                    </th>
                    <th className="p-2 text-end font-medium">
                      {t("reports.finance.fields.runningBalance")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detail.movements.map((m, index) => (
                    <tr key={`${m.journalEntryId}-${index}`} className="border-t border-border">
                      <td className="p-2">{formatDate(m.entryDate)}</td>
                      <td className="p-2">
                        <code dir="ltr">{m.entryNumber}</code>
                      </td>
                      <td className="p-2">{m.description ?? "—"}</td>
                      <td className="p-2 text-end">
                        <MoneyCell value={m.debit} />
                      </td>
                      <td className="p-2 text-end">
                        <MoneyCell value={m.credit} />
                      </td>
                      <td className="p-2 text-end">
                        <MoneyCell value={m.runningBalance} />
                      </td>
                    </tr>
                  ))}
                  {detail.movements.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-muted-foreground">
                        {t("common.noResults")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </EnterpriseModal>
    </>
  );
}
