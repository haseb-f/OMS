"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { StatusBadge } from "@/components/business/status-badge";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { SalesListBulkActions } from "@/components/sales";
import { JournalTraceCell } from "@/components/accounting/journal-trace-cell";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import {
  MultiEntityFilter,
  MultiSelectFilter,
  useSelectedRecords,
} from "@/components/shared/data-table";
import { ClearFiltersButton } from "@/components/shared/data-table/clear-filters-button";
import { PermissionGate } from "@/components/shared/permission-gate";
import {
  expenseVouchersService,
  type ExpenseCurrencyTotal,
  type FinancialTransactionRow,
  type FinancialTransactionStatusValue,
} from "@/services/expense-vouchers-service";
import {
  receivingAccountsService,
  type ReceivingAccountOption,
} from "@/services/receiving-accounts-service";
import { createMasterDataService } from "@/services/master-data-service";
import type { ChartOfAccountRow } from "@/config/master-data/entities";
import {
  TRANSACTION_ARCHIVABLE_STATUSES,
  TRANSACTION_FILTERABLE_STATUSES,
  TRANSACTION_STATUS_LABEL_KEY,
  TRANSACTION_STATUS_TONE,
} from "@/config/financial-transactions/status";
import { EXPENSES_ROUTE, expenseVoucherHref } from "@/config/finance/expense-voucher";
import { buildExpenseVoucherPrintPayload } from "@/config/finance/expense-voucher-print";
import {
  ExpenseVoucherActionsCell,
  type ExpenseVoucherRowHandlers,
} from "@/config/finance/expense-voucher-row-actions";
import { ExpenseVoucherGridCard } from "@/config/finance/expense-voucher-grid-card";
import { useUsersLookup } from "@/hooks/use-reference-data";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { usePrintCompany } from "@/components/print/print-brand";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { reportApiError, reportDestructiveDone, toast } from "@/lib/toast";
import { formatDate, toISODate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { cachedLookup } from "@/lib/lookup-cache";
import { fetchAllPages } from "@/lib/fetch-all-pages";

const EMPTY_DATE_RANGE: DateRangeValue = { from: null, to: null };
const accountsService = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");

/** "SAR 1,200.00 · EGP 300.00" — one figure per currency, never a mixed sum. */
function formatTotals(totals: ExpenseCurrencyTotal[]): string {
  return totals.length === 0
    ? "—"
    : totals.map((row) => formatMoney(row.amount, row.currencyCode ?? undefined)).join(" · ");
}

/**
 * Expenses (R13 owner decision 2) — the posting expense voucher
 * (FinancialTransaction EXPENSE_PAYMENT). Draft → Confirm & post (journal
 * entry by the Posting Engine) → Reverse. Filters: status, expense date,
 * expense account, paid-from account; totals per currency (reversed excluded).
 */
function ExpensesPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission, user } = useUserContext();
  const printCompany = usePrintCompany();
  const { runPrint } = usePrintEngine();
  const usersById = useUsersLookup();

  const [items, setItems] = useState<FinancialTransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<ExpenseCurrencyTotal[]>([]);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [search, setSearch] = usePathRestorableState("search", "");
  const [sortBy, setSortBy] = usePathRestorableState("sortBy", "transactionDate");
  const [sortOrder, setSortOrder] = usePathRestorableState<"asc" | "desc">("sortOrder", "desc");
  const [statusFilter, setStatusFilter] = usePathRestorableState<string[]>("status", []);
  const [accountFilter, setAccountFilter] = usePathRestorableState<ChartOfAccountRow[]>(
    "account",
    [],
  );
  const [paidFromFilter, setPaidFromFilter] = usePathRestorableState<string[]>("paidFrom", []);
  const [dateRange, setDateRange] = usePathRestorableState<DateRangeValue>(
    "dateRange",
    EMPTY_DATE_RANGE,
  );
  const [receivingAccounts, setReceivingAccounts] = useState<ReceivingAccountOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [reverseTarget, setReverseTarget] = useState<FinancialTransactionRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<FinancialTransactionRow | null>(null);
  const [bulkArchive, setBulkArchive] = useState<{
    targets: FinancialTransactionRow[];
    skipped: number;
  } | null>(null);

  useEffect(() => {
    receivingAccountsService
      .list()
      .then(setReceivingAccounts)
      .catch(() => setReceivingAccounts([]));
  }, []);

  const listFilters = useMemo(
    () => ({
      search: search || undefined,
      status: statusFilter as FinancialTransactionStatusValue[],
      expenseAccountId: accountFilter.map((account) => account.id),
      receivingAccountId: paidFromFilter,
      dateFrom: dateRange.from ? toISODate(dateRange.from) : undefined,
      dateTo: dateRange.to ? toISODate(dateRange.to) : undefined,
      sortBy,
      sortOrder,
    }),
    [search, statusFilter, accountFilter, paidFromFilter, dateRange, sortBy, sortOrder],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [result, currencyTotals] = await Promise.all([
        expenseVouchersService.list({ ...listFilters, page, pageSize }),
        expenseVouchersService.totals(listFilters),
      ]);
      setItems(result.items);
      setTotal(result.total);
      setTotals(currencyTotals);
    } catch (error) {
      reportApiError(error, "errors.loadFailed");
    } finally {
      setIsLoading(false);
    }
  }, [listFilters, page, pageSize]);

  const fetchAllRows = useCallback(
    () =>
      fetchAllPages((nextPage, nextPageSize) =>
        expenseVouchersService.list({ ...listFilters, page: nextPage, pageSize: nextPageSize }),
      ),
    [listFilters],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const toExportRow = useCallback(
    (item: FinancialTransactionRow): Record<string, string> => ({
      transactionNumber: item.transactionNumber,
      transactionDate: formatDate(item.transactionDate),
      description: item.description ?? "",
      expenseAccount: item.expenseAccount
        ? `${item.expenseAccount.code} ${item.expenseAccount.name}`
        : "",
      paidFrom: item.receivingAccount?.name ?? "",
      counterparty: item.partner?.name ?? "",
      costCenter: item.costCenter?.name ?? "",
      amount: item.amount,
      currency: item.currency?.code ?? "",
      status: t(TRANSACTION_STATUS_LABEL_KEY[item.status]),
      createdBy: item.createdBy ? (usersById[item.createdBy] ?? "") : "",
    }),
    [t, usersById],
  );

  const handlePrintRow = useCallback(
    (row: FinancialTransactionRow) =>
      void runPrint(
        "document",
        async () =>
          buildExpenseVoucherPrintPayload(await expenseVouchersService.get(row.id), {
            companyName: printCompany.name,
            companyLogoUrl: printCompany.logoUrl ?? null,
            printedByName: user?.fullName ?? null,
            t,
          }),
        "errors.printFailed",
      ),
    [runPrint, printCompany, user, t],
  );

  const handleReverseConfirmed = async () => {
    if (!reverseTarget) return;
    try {
      const reversed = await expenseVouchersService.cancel(reverseTarget.id);
      reportDestructiveDone(
        t("expenseVouchers.toasts.reversed", { number: reversed.transactionNumber }),
      );
      void load();
    } catch (error) {
      reportApiError(error, "errors.cancelFailed");
    } finally {
      setReverseTarget(null);
    }
  };

  const handleArchiveConfirmed = async () => {
    if (!archiveTarget) return;
    try {
      await expenseVouchersService.archive(archiveTarget.id);
      toast.success(t("financialTransactions.toasts.archived"));
      void load();
    } catch (error) {
      reportApiError(error, "errors.archiveFailed");
    } finally {
      setArchiveTarget(null);
    }
  };

  const rowHandlers = useMemo<ExpenseVoucherRowHandlers>(
    () => ({
      onView: (row) => router.push(expenseVoucherHref(row.id)),
      onPrint: handlePrintRow,
      onReverse: setReverseTarget,
      onArchive: setArchiveTarget,
    }),
    [router, handlePrintRow],
  );

  const columns = useMemo<ColumnDef<FinancialTransactionRow, unknown>[]>(
    () => [
      {
        id: "transactionNumber",
        meta: { titleKey: "expenseVouchers.fields.number", identity: true },
        accessorFn: (row) => row.transactionNumber,
        cell: ({ row }) => (
          <StackedCell
            primary={<SemanticValue kind="id">{row.original.transactionNumber}</SemanticValue>}
            secondary={
              <SemanticValue kind="date">{formatDate(row.original.transactionDate)}</SemanticValue>
            }
          />
        ),
      },
      {
        id: "description",
        meta: { titleKey: "expenseVouchers.fields.description" },
        enableSorting: false,
        accessorFn: (row) => row.description ?? row.expenseAccount?.name ?? "—",
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.description || "—"}
            secondary={
              row.original.expenseAccount
                ? `${row.original.expenseAccount.code} · ${row.original.expenseAccount.name}`
                : undefined
            }
          />
        ),
      },
      {
        id: "paidFrom",
        meta: { titleKey: "expenseVouchers.fields.paidFrom" },
        enableSorting: false,
        accessorFn: (row) => row.receivingAccount?.name ?? "—",
      },
      {
        id: "counterparty",
        meta: { titleKey: "expenseVouchers.fields.counterparty", defaultHidden: true },
        enableSorting: false,
        accessorFn: (row) => row.partner?.name ?? "—",
      },
      {
        id: "costCenter",
        meta: { titleKey: "expenseVouchers.fields.costCenter", defaultHidden: true },
        enableSorting: false,
        accessorFn: (row) => row.costCenter?.name ?? "—",
      },
      {
        id: "status",
        meta: { titleKey: "expenseVouchers.fields.status" },
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge
            label={t(TRANSACTION_STATUS_LABEL_KEY[row.original.status])}
            tone={TRANSACTION_STATUS_TONE[row.original.status]}
          />
        ),
      },
      {
        id: "journalEntry",
        meta: { titleKey: "expenseVouchers.fields.journalEntry", defaultHidden: true },
        enableSorting: false,
        cell: ({ row }) => (
          <JournalTraceCell
            sourceType="EXPENSE_PAYMENT"
            sourceId={row.original.status === "DRAFT" ? null : row.original.id}
            expected={row.original.status !== "DRAFT"}
          />
        ),
      },
      {
        id: "amount",
        meta: { titleKey: "expenseVouchers.fields.amount", type: "money" },
        accessorFn: (row) => row.amount,
        cell: ({ row }) => (
          <MoneyValue value={row.original.amount} currency={row.original.currency} />
        ),
      },
      {
        id: "createdBy",
        meta: { titleKey: "expenseVouchers.fields.createdBy", defaultHidden: true },
        enableSorting: false,
        accessorFn: (row) => (row.createdBy ? (usersById[row.createdBy] ?? "—") : "—"),
      },
      {
        id: "__actions",
        meta: { titleKey: "common.actions" },
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => <ExpenseVoucherActionsCell row={row.original} handlers={rowHandlers} />,
      },
    ],
    [t, usersById, rowHandlers],
  );

  const exportColumnKeys = [
    "transactionNumber",
    "description",
    "paidFrom",
    "counterparty",
    "costCenter",
    "amount",
    "status",
    "createdBy",
  ];

  const { selectedIds, selectedRecords, resolve } = useSelectedRecords({
    items,
    rowSelection,
    fetchAllRows,
    query: listFilters,
  });
  const isArchivable = (item: FinancialTransactionRow) =>
    TRANSACTION_ARCHIVABLE_STATUSES.includes(item.status);
  const archiveDisabled =
    selectedRecords.length === selectedIds.length && !selectedRecords.some(isArchivable);

  const handleBulkArchiveRequested = async () => {
    const records = await resolve();
    if (!records) return;
    const targets = records.filter(isArchivable);
    if (targets.length === 0) {
      toast.info(t("table.bulkNoneEligible"));
      return;
    }
    setBulkArchive({ targets, skipped: records.length - targets.length });
  };

  const handleBulkArchiveConfirmed = async () => {
    if (!bulkArchive) return;
    const { targets } = bulkArchive;
    setBulkArchive(null);
    let failures = 0;
    for (const item of targets) {
      try {
        await expenseVouchersService.archive(item.id);
      } catch {
        failures += 1;
      }
    }
    if (failures === 0) {
      toast.success(t("financialTransactions.toasts.bulkArchived", { count: targets.length }));
    } else {
      toast.error(t("financialTransactions.toasts.bulkArchiveFailed", { count: failures }));
    }
    setRowSelection({});
    void load();
  };

  const activeFilterCount =
    (statusFilter.length > 0 ? 1 : 0) +
    (accountFilter.length > 0 ? 1 : 0) +
    (paidFromFilter.length > 0 ? 1 : 0) +
    (dateRange.from || dateRange.to ? 1 : 0);

  return (
    <PageWorkspace
      dense
      title={t("expenseVouchers.title")}
      description={t("expenseVouchers.description")}
      actions={
        <HeaderActions
          primary={{
            key: "add-new",
            label: t("expenseVouchers.addNew"),
            icon: Plus,
            href: `${EXPENSES_ROUTE}/new`,
            hidden: !hasPermission("accounting.expense-payments.create"),
          }}
        />
      }
    >
      <EnterpriseDataTable
        filterBar={
          <>
            <MultiSelectFilter
              label={t("expenseVouchers.filters.status")}
              values={statusFilter}
              onChange={(values) => {
                setStatusFilter(values);
                setPage(1);
              }}
              options={TRANSACTION_FILTERABLE_STATUSES.map((status) => ({
                value: status,
                label: t(TRANSACTION_STATUS_LABEL_KEY[status]),
              }))}
            />
            <MultiEntityFilter
              label={t("expenseVouchers.filters.expenseAccount")}
              values={accountFilter}
              onChange={(accounts) => {
                setAccountFilter(accounts);
                setPage(1);
              }}
              onSearch={async (term) => {
                const params = {
                  search: term || undefined,
                  pageSize: 25,
                  accountType: "EXPENSE",
                  postingOnly: true,
                };
                const result = await cachedLookup(`accounts:${JSON.stringify(params)}`, () =>
                  accountsService.list(params),
                );
                return result.items;
              }}
              getId={(account) => account.id}
              getTitle={(account) => account.name}
              getSubtitle={(account) => account.code}
              subtitleDir="ltr"
            />
            <MultiSelectFilter
              label={t("expenseVouchers.filters.paidFrom")}
              values={paidFromFilter}
              onChange={(values) => {
                setPaidFromFilter(values);
                setPage(1);
              }}
              options={receivingAccounts.map((account) => ({
                value: account.id,
                label: account.name,
              }))}
              searchable
            />
            <EnterpriseDateRangePicker
              value={dateRange}
              onChange={(range) => {
                setDateRange(range);
                setPage(1);
              }}
            />
            <ClearFiltersButton
              activeCount={activeFilterCount}
              onClear={() => {
                setStatusFilter([]);
                setAccountFilter([]);
                setPaidFromFilter([]);
                setDateRange(EMPTY_DATE_RANGE);
                setPage(1);
              }}
            />
          </>
        }
        tableId="finance-expenses"
        printTitle={t("expenseVouchers.title")}
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
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        selectionResetKey={listFilters}
        bulkActions={
          <SalesListBulkActions
            onArchive={() => void handleBulkArchiveRequested()}
            archiveDisabled={archiveDisabled}
            labels={{ archive: t("common.archive") }}
          />
        }
        footerRow={{
          transactionNumber: t("expenseVouchers.totals.label"),
          amount: <span className="tabular-nums">{formatTotals(totals)}</span>,
        }}
        onRefresh={load}
        exportColumns={exportColumnsFromKeys(columns, exportColumnKeys, t)}
        onExport={(selectedKeys, labels) =>
          exportRowsToCsv(
            items.map((item) => toExportRow(item)) as unknown as Record<string, unknown>[],
            selectedKeys,
            "expenses.csv",
            labels,
          )
        }
        emptyTitle={t("expenseVouchers.empty")}
        renderGridCard={({ row, selected, onToggleSelected }) => (
          <ExpenseVoucherGridCard
            row={row}
            handlers={rowHandlers}
            selected={selected}
            onToggleSelected={onToggleSelected}
            href={expenseVoucherHref(row.id)}
          />
        )}
        getRowId={(row) => row.id}
        getRowHref={(row) => expenseVoucherHref(row.id)}
      />

      <ConfirmationDialog
        open={!!reverseTarget}
        onOpenChange={(open) => !open && setReverseTarget(null)}
        tone="destructive"
        title={t("expenseVouchers.reverseDialog.title")}
        description={t("expenseVouchers.reverseDialog.description")}
        confirmLabel={t("expenseVouchers.actions.reverse")}
        cancelLabel={t("common.close")}
        onConfirm={handleReverseConfirmed}
      />

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        tone="destructive"
        title={t("financialTransactions.confirmArchiveTitle")}
        description={t("financialTransactions.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleArchiveConfirmed}
      />

      <ConfirmationDialog
        open={!!bulkArchive}
        onOpenChange={(open) => !open && setBulkArchive(null)}
        tone="destructive"
        title={t("financialTransactions.bulk.archiveConfirmTitle", {
          count: bulkArchive?.targets.length ?? 0,
        })}
        description={
          bulkArchive?.skipped
            ? `${t("financialTransactions.confirmArchiveDescription")} ${t("table.bulkIneligibleSkipped", { count: bulkArchive.skipped })}`
            : t("financialTransactions.confirmArchiveDescription")
        }
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleBulkArchiveConfirmed}
      />
    </PageWorkspace>
  );
}

export default function ExpensesPage() {
  return (
    <PermissionGate permission="accounting.expense-payments.view">
      <ExpensesPageContent />
    </PermissionGate>
  );
}
