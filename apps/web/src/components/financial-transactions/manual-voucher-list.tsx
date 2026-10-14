"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge } from "@/components/business/status-badge";
import { BaseAwareMoneyValue } from "@/components/shared/base-aware-money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { MultiSelectFilter } from "@/components/shared/data-table";
import { ClearFiltersButton } from "@/components/shared/data-table/clear-filters-button";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import {
  TRANSACTION_FILTERABLE_STATUSES,
  TRANSACTION_STATUS_LABEL_KEY,
  TRANSACTION_STATUS_TONE,
} from "@/config/financial-transactions/status";
import {
  internalTransfersService,
  otherPaymentsService,
  otherReceiptsService,
} from "@/services/voucher-services";
import type {
  FinancialTransactionRow,
  FinancialTransactionStatusValue,
} from "@/services/financial-transactions-service";
import { useRestorableState } from "@/hooks/use-restorable-state";
import { useDataChanged } from "@/hooks/use-data-changed";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";
import { fetchAllPages } from "@/lib/fetch-all-pages";
import { formatDate, toISODate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

export type ManualVoucherKind = "OTHER_RECEIPT" | "OTHER_PAYMENT" | "INTERNAL_TRANSFER";

/** The one permission every manual-entry voucher list needs (stream T: list / get = view). */
export const MANUAL_VOUCHER_VIEW_PERMISSION = "accounting.journal-entries.view";

const EMPTY_DATE_RANGE: DateRangeValue = { from: null, to: null };

interface ManualVoucherKindConfig {
  service: typeof otherReceiptsService;
  tableId: string;
  titleKey: MessageKey;
  emptyKey: MessageKey;
  /** The saved voucher's route in the one voucher card. */
  href: (id: string) => string;
}

export const MANUAL_VOUCHER_KINDS: Record<ManualVoucherKind, ManualVoucherKindConfig> = {
  OTHER_RECEIPT: {
    service: otherReceiptsService,
    tableId: "other-receipts",
    titleKey: "vouchers.lists.otherReceipts",
    emptyKey: "vouchers.lists.emptyOtherReceipts",
    href: (id) => `/sales/payments/${id}?purpose=other`,
  },
  OTHER_PAYMENT: {
    service: otherPaymentsService,
    tableId: "other-payments",
    titleKey: "vouchers.lists.otherPayments",
    emptyKey: "vouchers.lists.emptyOtherPayments",
    href: (id) => `/purchasing/payments/${id}?purpose=other`,
  },
  INTERNAL_TRANSFER: {
    service: internalTransfersService,
    tableId: "internal-transfers",
    titleKey: "vouchers.lists.transfers",
    emptyKey: "vouchers.lists.emptyTransfers",
    href: (id) => `/purchasing/payments/${id}?purpose=transfer`,
  },
};

/**
 * R22 D4 — the list of saved other receipts, other payments or internal
 * transfers (stream T endpoints), on the same EnterpriseDataTable (Table /
 * Grid, the automatic record card) as every voucher list: number + date,
 * counter-account (other) or from → to accounts (transfer), status badge,
 * amount with its currency; each row opens the saved voucher in the card.
 * Refreshes after any money operation (`settlement`) and on tab return.
 */
export function ManualVoucherList({ kind }: { kind: ManualVoucherKind }) {
  const { t } = useLocale();
  const config = MANUAL_VOUCHER_KINDS[kind];
  const key = (suffix: string) => `oms.list:manual-vouchers:${kind}:${suffix}`;
  const [items, setItems] = useState<FinancialTransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useRestorableState(key("page"), 1);
  const [pageSize, setPageSize] = useRestorableState(key("pageSize"), 20);
  const [search, setSearch] = useRestorableState(key("search"), "");
  const [sortBy, setSortBy] = useRestorableState(key("sortBy"), "transactionDate");
  const [sortOrder, setSortOrder] = useRestorableState<"asc" | "desc">(key("sortOrder"), "desc");
  const [statusFilter, setStatusFilter] = useRestorableState<string[]>(key("status"), []);
  const [dateRange, setDateRange] = useRestorableState<DateRangeValue>(
    key("dateRange"),
    EMPTY_DATE_RANGE,
  );
  const [isLoading, setIsLoading] = useState(true);

  const listFilters = useMemo(
    () => ({
      search: search || undefined,
      status: statusFilter as FinancialTransactionStatusValue[],
      dateFrom: dateRange.from ? toISODate(dateRange.from) : undefined,
      dateTo: dateRange.to ? toISODate(dateRange.to) : undefined,
      sortBy,
      sortOrder,
    }),
    [search, statusFilter, dateRange, sortBy, sortOrder],
  );

  const { service } = config;
  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await service.list({ ...listFilters, page, pageSize });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      reportApiError(error, "errors.loadFailed");
    } finally {
      setIsLoading(false);
    }
  }, [service, listFilters, page, pageSize]);

  const fetchAllRows = useCallback(
    () =>
      fetchAllPages((nextPage, nextPageSize) =>
        service.list({ ...listFilters, page: nextPage, pageSize: nextPageSize }),
      ),
    [service, listFilters],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useDataChanged("settlement", load);

  const isTransfer = kind === "INTERNAL_TRANSFER";
  const columns = useMemo<ColumnDef<FinancialTransactionRow, unknown>[]>(
    () => [
      {
        id: "transactionNumber",
        meta: { titleKey: "vouchers.lists.number", type: "code", identity: true },
        accessorFn: (row) => row.transactionNumber,
        cell: ({ row }) => (
          <StackedCell
            primary={<SemanticValue kind="id">{row.original.transactionNumber}</SemanticValue>}
            secondary={
              row.original.referenceNumber ? (
                <SemanticValue kind="id">{row.original.referenceNumber}</SemanticValue>
              ) : undefined
            }
          />
        ),
      },
      isTransfer
        ? {
            id: "accounts",
            meta: { titleKey: "vouchers.lists.fromTo", type: "name" },
            enableSorting: false,
            accessorFn: (row) =>
              `${row.receivingAccount?.name ?? "—"} → ${row.targetReceivingAccount?.name ?? "—"}`,
            cell: ({ row }) => (
              <StackedCell
                primary={row.original.receivingAccount?.name ?? "—"}
                secondary={`${t("vouchers.fields.transferTo")}: ${row.original.targetReceivingAccount?.name ?? "—"}`}
              />
            ),
          }
        : {
            id: "counterAccount",
            meta: { titleKey: "vouchers.lists.counterAccount", type: "name" },
            enableSorting: false,
            accessorFn: (row) =>
              row.counterAccount ? `${row.counterAccount.code} · ${row.counterAccount.name}` : "—",
            cell: ({ row }) => (
              <StackedCell
                primary={
                  row.original.counterAccount
                    ? `${row.original.counterAccount.code} · ${row.original.counterAccount.name}`
                    : "—"
                }
                secondary={row.original.receivingAccount?.name ?? undefined}
              />
            ),
          },
      {
        id: "status",
        meta: { titleKey: "vouchers.lists.status", type: "status", minWidth: 96, maxWidth: 128 },
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge
            label={t(TRANSACTION_STATUS_LABEL_KEY[row.original.status])}
            tone={TRANSACTION_STATUS_TONE[row.original.status]}
          />
        ),
      },
      {
        id: "amount",
        meta: { titleKey: "vouchers.lists.amount", type: "money" },
        accessorFn: (row) => Number(row.amount),
        cell: ({ row }) => (
          <BaseAwareMoneyValue value={row.original.amount} currency={row.original.currency?.code} />
        ),
      },
      {
        id: "transactionDate",
        meta: { titleKey: "vouchers.lists.date", type: "date" },
        accessorFn: (row) => formatDate(row.transactionDate),
        cell: ({ row }) => (
          <SemanticValue kind="date">{formatDate(row.original.transactionDate)}</SemanticValue>
        ),
      },
    ],
    [t, isTransfer],
  );

  return (
    <EnterpriseDataTable
      filterBar={
        <>
          <MultiSelectFilter
            label={t("vouchers.lists.status")}
            values={statusFilter}
            onChange={(values) => {
              setStatusFilter(values);
              setPage(1);
            }}
            options={TRANSACTION_FILTERABLE_STATUSES.map((status) => ({
              value: status,
              label: t(TRANSACTION_STATUS_LABEL_KEY[status]),
              tone: TRANSACTION_STATUS_TONE[status],
            }))}
          />
          <EnterpriseDateRangePicker
            value={dateRange}
            onChange={(range) => {
              setDateRange(range);
              setPage(1);
            }}
          />
          <ClearFiltersButton
            activeCount={
              (statusFilter.length > 0 ? 1 : 0) + (dateRange.from || dateRange.to ? 1 : 0)
            }
            onClear={() => {
              setStatusFilter([]);
              setDateRange(EMPTY_DATE_RANGE);
              setPage(1);
            }}
          />
        </>
      }
      tableId={config.tableId}
      printTitle={t(config.titleKey)}
      columns={columns}
      data={items}
      totalCount={total}
      page={page}
      pageSize={pageSize}
      onPageChange={setPage}
      fetchAllRows={fetchAllRows}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
      sortBy={sortBy}
      sortOrder={sortOrder}
      onSortChange={(nextSortBy, nextSortOrder) => {
        setSortBy(nextSortBy);
        setSortOrder(nextSortOrder);
      }}
      search={search}
      onSearchChange={(value) => {
        setSearch(value);
        setPage(1);
      }}
      isLoading={isLoading}
      onRefresh={load}
      emptyTitle={t(config.emptyKey)}
      getRowId={(row) => row.id}
      getRowHref={(row) => config.href(row.id)}
    />
  );
}
