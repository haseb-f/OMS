"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye, ScrollText } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/business/status-badge";
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
  type JournalReportEntry,
} from "@/services/accounting-reports-service";
import {
  JOURNAL_ENTRY_STATUS_LABEL_KEY,
  JOURNAL_ENTRY_STATUS_TONE,
} from "@/config/accounting/status";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDate, toISODate } from "@/lib/date";
import { MoneyCell, toExportRows } from "./shared";

export function JournalReportTab() {
  const { t } = useLocale();
  const [filters, setFilters] = useState<ReportFilterValue>(EMPTY_REPORT_FILTERS);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<JournalReportEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [isLoading, setIsLoading] = useState(true);
  const [detail, setDetail] = useState<JournalReportEntry | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await accountingReportsService.journalReport({
        search: search || undefined,
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
        sortOrder,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsLoading(false);
    }
  }, [search, filters, page, pageSize, sortOrder, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns = useMemo<ColumnDef<JournalReportEntry, unknown>[]>(
    () => [
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
        id: "entryDate",
        meta: { titleKey: "reports.finance.fields.entryDate" },
        accessorFn: (row) => formatDate(row.entryDate),
      },
      {
        id: "sourceType",
        meta: { titleKey: "reports.finance.fields.sourceDocument" },
        enableSorting: false,
        accessorFn: (row) => row.sourceType ?? "—",
      },
      {
        id: "description",
        meta: { titleKey: "reports.finance.fields.description" },
        enableSorting: false,
        accessorFn: (row) => row.description ?? "—",
      },
      {
        id: "totalDebit",
        meta: { titleKey: "reports.finance.fields.debit" },
        accessorFn: (row) => Number(row.totalDebit),
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
      {
        id: "totalCredit",
        meta: { titleKey: "reports.finance.fields.credit" },
        accessorFn: (row) => Number(row.totalCredit),
        cell: (info) => <MoneyCell value={info.getValue() as number} />,
      },
      {
        id: "status",
        meta: { titleKey: "accounting.journalEntries.fields.status" },
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge
            label={t(JOURNAL_ENTRY_STATUS_LABEL_KEY[row.original.status])}
            tone={JOURNAL_ENTRY_STATUS_TONE[row.original.status]}
          />
        ),
      },
      {
        id: "postedBy",
        meta: { titleKey: "reports.finance.fields.postedBy" },
        enableSorting: false,
        accessorFn: (row) => row.postedBy ?? "—",
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
            aria-label={t("reports.finance.viewLines")}
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
    "entryNumber",
    "entryDate",
    "sourceType",
    "description",
    "totalDebit",
    "totalCredit",
    "status",
    "postedBy",
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
          />
        }
        tableId="reports-finance-journal-report"
        printTitle={t("reports.finance.journalReport")}
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
        sortBy="entryDate"
        sortOrder={sortOrder}
        onSortChange={(_sortBy, order) => setSortOrder(order)}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        isLoading={isLoading}
        getRowId={(row) => row.id}
        exportColumns={exportColumnsFromKeys(columns, exportKeys, t)}
        onExport={(keys) =>
          exportRowsToCsv(toExportRows(columns, items), keys, "journal-report.csv")
        }
      />

      <EnterpriseModal
        open={!!detail}
        onOpenChange={(open) => !open && setDetail(null)}
        icon={ScrollText}
        title={detail ? detail.entryNumber : ""}
        size="lg"
        footer={(requestClose) => (
          <EnterpriseButton type="button" variant="outline" onClick={requestClose}>
            {t("common.close")}
          </EnterpriseButton>
        )}
      >
        {detail && (
          <div className="max-h-96 overflow-y-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-start font-medium">
                    {t("reports.finance.fields.accountCode")}
                  </th>
                  <th className="p-2 text-start font-medium">
                    {t("reports.finance.fields.accountName")}
                  </th>
                  <th className="p-2 text-start font-medium">
                    {t("reports.finance.fields.description")}
                  </th>
                  <th className="p-2 text-end font-medium">{t("reports.finance.fields.debit")}</th>
                  <th className="p-2 text-end font-medium">{t("reports.finance.fields.credit")}</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((line) => (
                  <tr key={line.id} className="border-t border-border">
                    <td className="p-2">{line.account.code}</td>
                    <td className="p-2">{line.account.name}</td>
                    <td className="p-2">{line.description ?? "—"}</td>
                    <td className="p-2 text-end">
                      <MoneyCell value={Number(line.debit)} />
                    </td>
                    <td className="p-2 text-end">
                      <MoneyCell value={Number(line.credit)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </EnterpriseModal>
    </>
  );
}
