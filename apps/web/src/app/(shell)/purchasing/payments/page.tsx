"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
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
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import {
  MultiSelectFilter,
  MultiEntityFilter,
  useSelectedRecords,
} from "@/components/shared/data-table";
import { ClearFiltersButton } from "@/components/shared/data-table/clear-filters-button";
import {
  supplierPaymentsService,
  type FinancialTransactionRow,
} from "@/services/supplier-payments-service";
import type { FinancialTransactionStatusValue } from "@/services/financial-transactions-service";
import { partnersService, type PartnerPickerRow } from "@/services/partners-service";
import { useUsersLookup } from "@/hooks/use-reference-data";
import {
  TRANSACTION_ARCHIVABLE_STATUSES,
  TRANSACTION_FILTERABLE_STATUSES,
  TRANSACTION_STATUS_LABEL_KEY,
  TRANSACTION_STATUS_TONE,
} from "@/config/financial-transactions/status";
import { buildPaymentPrintPayload } from "@/config/purchasing/payment-print";
import {
  SupplierPaymentActionsCell,
  type SupplierPaymentRowHandlers,
} from "@/config/purchasing/payment-row-actions";
import { SupplierPaymentGridCard } from "@/config/purchasing/purchasing-grid-cards";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { usePrintCompany } from "@/components/print/print-brand";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { reportApiError, reportDestructiveDone, toast } from "@/lib/toast";
import { formatDate, toISODate } from "@/lib/date";
import { PermissionGate } from "@/components/shared/permission-gate";
import { fetchAllPages } from "@/lib/fetch-all-pages";

const EMPTY_DATE_RANGE: DateRangeValue = { from: null, to: null };

/** Mirrors `sales/payments/page.tsx` exactly. */
function SupplierPaymentsPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission, user } = useUserContext();
  const { activeCompany } = useCompany();
  const printCompany = usePrintCompany();
  const { runPrint } = usePrintEngine();

  const [items, setItems] = useState<FinancialTransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [search, setSearch] = usePathRestorableState("search", "");
  const [sortBy, setSortBy] = usePathRestorableState("sortBy", "createdAt");
  const [sortOrder, setSortOrder] = usePathRestorableState<"asc" | "desc">("sortOrder", "desc");
  const [statusFilter, setStatusFilter] = usePathRestorableState<string[]>("status", []);
  const [supplierFilter, setSupplierFilter] = usePathRestorableState<PartnerPickerRow[]>(
    "supplier",
    [],
  );
  const [dateRange, setDateRange] = usePathRestorableState<DateRangeValue>(
    "dateRange",
    EMPTY_DATE_RANGE,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const usersById = useUsersLookup();
  const [cancelTarget, setCancelTarget] = useState<FinancialTransactionRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<FinancialTransactionRow | null>(null);
  const [bulkArchive, setBulkArchive] = useState<{
    targets: FinancialTransactionRow[];
    skipped: number;
  } | null>(null);

  const listFilters = useMemo(
    () => ({
      search: search || undefined,
      status: statusFilter as FinancialTransactionStatusValue[],
      partnerId: supplierFilter.map((supplier) => supplier.id),
      dateFrom: dateRange.from ? toISODate(dateRange.from) : undefined,
      dateTo: dateRange.to ? toISODate(dateRange.to) : undefined,
      sortBy,
      sortOrder,
    }),
    [search, statusFilter, supplierFilter, dateRange, sortBy, sortOrder],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await supplierPaymentsService.list({ ...listFilters, page, pageSize });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      reportApiError(error, "errors.loadFailed");
    } finally {
      setIsLoading(false);
    }
  }, [listFilters, page, pageSize]);

  // Print: every row matching the current filters/sort, not just the loaded page.
  const fetchAllRows = useCallback(
    () =>
      fetchAllPages((nextPage, nextPageSize) =>
        supplierPaymentsService.list({ ...listFilters, page: nextPage, pageSize: nextPageSize }),
      ),
    [listFilters],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const canCreate = hasPermission("purchasing.payments.create");

  const toPrintRow = useCallback(
    (item: FinancialTransactionRow): Record<string, string> => ({
      transactionNumber: item.transactionNumber,
      partner: item.partner?.name ?? "",
      referenceNumber: item.referenceNumber ?? "",
      amount: item.amount,
      status: t(TRANSACTION_STATUS_LABEL_KEY[item.status]),
      createdAt: formatDate(item.createdAt),
      createdBy: item.createdBy ? (usersById[item.createdBy] ?? "") : "",
    }),
    [t, usersById],
  );

  // The preview tab opens inside the click; runPrint closes it and shows
  // the reason if the record cannot be loaded.
  const handlePrintRow = (row: FinancialTransactionRow) =>
    void runPrint(
      "document",
      async () => {
        const full = await supplierPaymentsService.get(row.id);
        return buildPaymentPrintPayload(full, {
          companyName: printCompany.name,
          companyLogoUrl: printCompany.logoUrl ?? null,
          printedByName: user?.fullName ?? null,
          t,
        });
      },
      "errors.printFailed",
    );

  const handleCancelConfirmed = async () => {
    if (!cancelTarget) return;
    try {
      await supplierPaymentsService.cancel(cancelTarget.id);
      reportDestructiveDone(t("financialTransactions.toasts.cancelled"));
      void load();
    } catch (error) {
      reportApiError(error, "errors.cancelFailed");
    } finally {
      setCancelTarget(null);
    }
  };

  const handleArchiveConfirmed = async () => {
    if (!archiveTarget) return;
    try {
      await supplierPaymentsService.archive(archiveTarget.id);
      toast.success(t("financialTransactions.toasts.archived"));
      void load();
    } catch (error) {
      reportApiError(error, "errors.archiveFailed");
    } finally {
      setArchiveTarget(null);
    }
  };

  const rowHandlers = useMemo<SupplierPaymentRowHandlers>(
    () => ({
      onView: (row) => router.push(`/purchasing/payments/${row.id}`),
      onPrint: handlePrintRow,
      onCancel: setCancelTarget,
      onArchive: setArchiveTarget,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, activeCompany, user],
  );

  const columns = useMemo<ColumnDef<FinancialTransactionRow, unknown>[]>(
    () => [
      {
        id: "transactionNumber",
        meta: { titleKey: "purchasing.payments.fields.number", identity: true },
        accessorFn: (row) => row.transactionNumber,
        cell: ({ row }) => (
          <StackedCell
            primary={<SemanticValue kind="id">{row.original.transactionNumber}</SemanticValue>}
            secondary={
              <SemanticValue kind="date">{formatDate(row.original.createdAt)}</SemanticValue>
            }
          />
        ),
      },
      {
        id: "supplier",
        meta: { titleKey: "purchasing.payments.fields.supplier" },
        accessorFn: (row) => row.partner?.name ?? "—",
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.partner?.name ?? "—"}
            secondary={
              row.original.referenceNumber ? (
                <SemanticValue kind="id">{row.original.referenceNumber}</SemanticValue>
              ) : undefined
            }
          />
        ),
      },
      {
        id: "referenceNumber",
        meta: { titleKey: "purchasing.payments.fields.reference", defaultHidden: true },
        accessorFn: (row) => row.referenceNumber ?? "—",
        enableSorting: false,
      },
      {
        id: "status",
        meta: { titleKey: "purchasing.suppliers.fields.status" },
        enableSorting: false,
        cell: ({ row }) => (
          <StackedCell
            primary={
              <StatusBadge
                label={t(TRANSACTION_STATUS_LABEL_KEY[row.original.status])}
                tone={TRANSACTION_STATUS_TONE[row.original.status]}
              />
            }
            secondary={<MoneyValue value={row.original.amount} />}
          />
        ),
      },
      {
        id: "amount",
        meta: { titleKey: "purchasing.payments.fields.amount", defaultHidden: true },
        accessorFn: (row) => row.amount,
        cell: (info) => <MoneyValue value={info.getValue() as string} />,
      },
      {
        id: "createdAt",
        meta: { titleKey: "purchasing.payments.fields.date", defaultHidden: true },
        accessorFn: (row) => formatDate(row.createdAt),
      },
      {
        id: "createdBy",
        meta: { titleKey: "purchasing.payments.fields.createdBy", defaultHidden: true },
        enableSorting: false,
        accessorFn: (row) => (row.createdBy ? (usersById[row.createdBy] ?? "—") : "—"),
      },
      {
        id: "__actions",
        meta: { titleKey: "common.actions" },
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => <SupplierPaymentActionsCell row={row.original} handlers={rowHandlers} />,
      },
    ],
    [t, usersById, rowHandlers],
  );

  const exportColumnKeys = [
    "transactionNumber",
    "supplier",
    "referenceNumber",
    "amount",
    "status",
    "createdAt",
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
  // Every selected record known -> disable when none is archivable; otherwise
  // the selection reaches past loaded pages and is resolved on click.
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
        await supplierPaymentsService.archive(item.id);
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

  return (
    <PageWorkspace
      dense
      title={t("purchasing.payments.title")}
      description={t("purchasing.payments.description")}
      actions={
        <HeaderActions
          inline={<ModuleImportButtons importType="SUPPLIER_PAYMENTS" onImported={load} />}
          primary={{
            key: "add-new",
            label: t("purchasing.payments.addNew"),
            icon: Plus,
            href: "/purchasing/payments/new",
            hidden: !canCreate,
          }}
        />
      }
    >
      <EnterpriseDataTable
        filterBar={
          <>
            <MultiSelectFilter
              label={t("purchasing.payments.filters.status")}
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
            <MultiEntityFilter
              label={t("purchasing.payments.fields.supplier")}
              values={supplierFilter}
              onChange={(suppliers) => {
                setSupplierFilter(suppliers);
                setPage(1);
              }}
              onSearch={async (search) => {
                const result = await partnersService.catalog({
                  search: search || undefined,
                  pageSize: 20,
                  role: ["SUPPLIER"],
                });
                return result.items;
              }}
              getId={(supplier) => supplier.id}
              getTitle={(supplier) => supplier.name}
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
                (statusFilter.length > 0 ? 1 : 0) +
                (supplierFilter.length > 0 ? 1 : 0) +
                (dateRange.from || dateRange.to ? 1 : 0)
              }
              onClear={() => {
                setStatusFilter([]);
                setSupplierFilter([]);
                setDateRange(EMPTY_DATE_RANGE);
                setPage(1);
              }}
            />
          </>
        }

        tableId="purchasing-payments"
        printTitle={t("purchasing.payments.title")}
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
            labels={{
              archive: t("common.archive"),
            }}
          />
        }
        onRefresh={load}
        exportColumns={exportColumnsFromKeys(columns, exportColumnKeys, t)}
        onExport={(selectedKeys, labels) =>
          exportRowsToCsv(
            items.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
            selectedKeys,
            "supplier-payment-vouchers.csv",
            labels,
          )
        }
        emptyTitle={t("purchasing.payments.empty")}
        renderGridCard={({ row, selected, onToggleSelected }) => (
          <SupplierPaymentGridCard
            row={row}
            handlers={rowHandlers}
            usersById={usersById}
            selected={selected}
            onToggleSelected={onToggleSelected}
            href={`/purchasing/payments/${row.id}`}
          />
        )}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/purchasing/payments/${row.id}`}
      />

      <ConfirmationDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        tone="destructive"
        title={t("financialTransactions.confirmCancelTitle")}
        description={t("financialTransactions.confirmCancelDescription")}
        confirmLabel={t("financialTransactions.actions.cancel")}
        cancelLabel={t("common.close")}
        onConfirm={handleCancelConfirmed}
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

export default function SupplierPaymentsPage() {
  return (
    <PermissionGate permission="purchasing.payments.view">
      <SupplierPaymentsPageContent />
    </PermissionGate>
  );
}
