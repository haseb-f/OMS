"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { EmptyState } from "@/components/shared/empty-state";
import { UsersRound } from "lucide-react";
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
  type PartnerStatementMovement,
  type PartnerStatementResult,
} from "@/services/accounting-reports-service";
import { PartnerPicker } from "@/components/business/partner-picker";
import type { PartnerRoleValue, PartnerRow } from "@/services/partners-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDate, toISODate } from "@/lib/date";
import { MoneyCell, toExportRows } from "./shared";

export function PartnerStatementTab({ role }: { role: PartnerRoleValue }) {
  const { t } = useLocale();
  const [filters, setFilters] = useState<ReportFilterValue>(EMPTY_REPORT_FILTERS);
  const [partner, setPartner] = useState<PartnerRow | null>(null);
  const [statement, setStatement] = useState<PartnerStatementResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const load = useCallback(async () => {
    if (!partner) {
      setStatement(null);
      return;
    }
    setIsLoading(true);
    try {
      const result = await accountingReportsService.partnerStatement(partner.id, {
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
      setStatement(result);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsLoading(false);
    }
  }, [partner, filters, page, pageSize, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo<ColumnDef<PartnerStatementMovement, unknown>[]>(
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
      },
      {
        id: "accountCode",
        meta: { titleKey: "reports.finance.fields.accountCode" },
        accessorFn: (row) => row.accountCode,
      },
      {
        id: "description",
        meta: { titleKey: "reports.finance.fields.description" },
        accessorFn: (row) => row.description ?? row.sourceType ?? "",
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
    "accountCode",
    "description",
    "debit",
    "credit",
    "runningBalance",
  ];

  return (
    <div className="flex flex-col gap-3">
      <FilterSurface>
        <div className="grid gap-3 md:grid-cols-2">
          <PartnerPicker role={role} value={partner} onChange={setPartner} />
        </div>
        <AccountingReportFilterBar
          value={filters}
          onChange={(next) => {
            setFilters(next);
            setPage(1);
          }}
        />
      </FilterSurface>

      {!partner ? (
        <EmptyState
          icon={UsersRound}
          title={t("reports.finance.partnerStatement.selectTitle")}
          description={t("reports.finance.partnerStatement.selectDescription")}
        />
      ) : (
        <>
          {statement ? (
            <div className="flex flex-wrap items-center justify-end gap-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <span>
                {t("reports.finance.fields.openingBalance")}{" "}
                <MoneyCell value={statement.openingBalance} />
              </span>
              <span>
                {t("reports.finance.fields.closingBalance")}{" "}
                <MoneyCell value={statement.closingBalance} />
              </span>
            </div>
          ) : null}
          <EnterpriseDataTable
            tableId={`reports-partner-statement-${role.toLowerCase()}`}
            printTitle={t("reports.finance.partnerStatement.title")}
            columns={columns}
            data={statement?.movements ?? []}
            totalCount={statement?.total ?? 0}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            isLoading={isLoading}
            getRowId={(row) => `${row.journalEntryId}-${row.accountCode}-${row.runningBalance}`}
            exportColumns={exportColumnsFromKeys(columns, exportKeys, t)}
            onExport={(keys) =>
              exportRowsToCsv(
                toExportRows(columns, statement?.movements ?? []),
                keys,
                "partner-statement.csv",
              )
            }
          />
        </>
      )}
    </div>
  );
}
