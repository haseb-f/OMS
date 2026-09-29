"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RowSelectionState } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { SalesListBulkActions } from "@/components/sales";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import {
  MultiSelectFilter,
  MultiEntityFilter,
  buildDocumentDetailRegions,
  documentDetailLabels,
  toDocumentLineItems,
  useMatchingSelection,
} from "@/components/shared/data-table";
import { ClearFiltersButton } from "@/components/shared/data-table/clear-filters-button";
import {
  salesOrdersService,
  type SalesDocumentStatusValue,
  type SalesOrderRow,
} from "@/services/sales-orders-service";
import { partnersService, type PartnerPickerRow } from "@/services/partners-service";
import { useUsersLookup } from "@/hooks/use-reference-data";
import { buildOrderColumns, orderExportColumns } from "@/config/sales/order-columns";
import {
  ORDER_ARCHIVABLE_STATUSES,
  ORDER_FILTERABLE_STATUSES,
  ORDER_STATUS_LABEL_KEY,
} from "@/config/sales/order-status";
import { buildOrderPrintPayload } from "@/config/sales/order-print";
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

function SalesOrdersPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission, user } = useUserContext();
  const { activeCompany } = useCompany();
  const printCompany = usePrintCompany();
  const { printList, runPrint } = usePrintEngine();

  const [items, setItems] = useState<SalesOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [search, setSearch] = usePathRestorableState("search", "");
  const [sortBy, setSortBy] = usePathRestorableState("sortBy", "createdAt");
  const [sortOrder, setSortOrder] = usePathRestorableState<"asc" | "desc">("sortOrder", "desc");
  const [statusFilter, setStatusFilter] = usePathRestorableState<string[]>("status", []);
  const [customerFilter, setCustomerFilter] = usePathRestorableState<PartnerPickerRow[]>(
    "customer",
    [],
  );
  const [dateRange, setDateRange] = usePathRestorableState<DateRangeValue>(
    "dateRange",
    EMPTY_DATE_RANGE,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // Cross-page selection (Part 7) — `rowSelection` itself is already ID-keyed
  // and survives pagination (see `EnterpriseDataTable`'s `getRowId`), but
  // `items` only ever holds the CURRENT page. Bulk print/export need the
  // actual row data (customer name, totals, ...), not just IDs, so every
  // page fetched is merged into this cache instead of being discarded —
  // a row selected on page 1 keeps its data available after paging to 2.
  const [itemsCache, setItemsCache] = useState<Record<string, SalesOrderRow>>({});
  const usersById = useUsersLookup();
  const [cancelTarget, setCancelTarget] = useState<SalesOrderRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<SalesOrderRow | null>(null);
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);

  const listFilters = useMemo(
    () => ({
      search: search || undefined,
      status: statusFilter as SalesDocumentStatusValue[],
      partnerId: customerFilter.map((customer) => customer.id),
      dateFrom: dateRange.from ? toISODate(dateRange.from) : undefined,
      dateTo: dateRange.to ? toISODate(dateRange.to) : undefined,
      sortBy,
      sortOrder,
    }),
    [search, statusFilter, customerFilter, dateRange, sortBy, sortOrder],
  );
  const matching = useMatchingSelection(listFilters);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await salesOrdersService.list({ ...listFilters, page, pageSize });
      setItems(result.items);
      setTotal(result.total);
      setItemsCache((cache) => ({
        ...cache,
        ...Object.fromEntries(result.items.map((item) => [item.id, item])),
      }));
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
        salesOrdersService.list({ ...listFilters, page: nextPage, pageSize: nextPageSize }),
      ),
    [listFilters],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const canCreate = hasPermission("sales.orders.create");

  const toPrintRow = useCallback(
    (item: SalesOrderRow): Record<string, string> => ({
      orderNumber: item.orderNumber,
      partner: item.partner?.name ?? "",
      referenceNumber: item.referenceNumber ?? "",
      grandTotal: item.grandTotal,
      status: t(ORDER_STATUS_LABEL_KEY[item.status]),
      createdAt: formatDate(item.createdAt),
      createdBy: item.createdBy ? (usersById[item.createdBy] ?? "") : "",
    }),
    [t, usersById],
  );

  const handleDuplicate = async (row: SalesOrderRow) => {
    try {
      const created = await salesOrdersService.create({
        partnerId: row.partnerId,
        currencyId: row.currencyId ?? undefined,
        referenceNumber: row.referenceNumber ?? undefined,
        internalNotes: row.internalNotes ?? undefined,
        customerNotes: row.customerNotes ?? undefined,
        items: row.items.map((item) => ({
          productId: item.productId,
          description: item.description ?? undefined,
          warehouseId: item.warehouseId ?? undefined,
          unitId: item.unitId,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          discountPercent: Number(item.discountPercent),
          discountValue: Number(item.discountValue),
          taxId: item.taxId ?? undefined,
          notes: item.notes ?? undefined,
        })),
      });
      toast.success(t("sales.orders.toasts.duplicated"));
      router.push(`/sales/orders/${created.id}`);
    } catch (error) {
      reportApiError(error, "errors.duplicateFailed");
    }
  };

  // The preview tab opens inside the click; runPrint closes it and shows
  // the reason if the record cannot be loaded.
  const handlePrintRow = (row: SalesOrderRow) =>
    void runPrint(
      "document",
      async () => {
        const full = await salesOrdersService.get(row.id);
        return buildOrderPrintPayload(full, {
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
      await salesOrdersService.cancel(cancelTarget.id);
      reportDestructiveDone(t("sales.orders.toasts.cancelled"));
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
      await salesOrdersService.archive(archiveTarget.id);
      toast.success(t("sales.orders.toasts.archived"));
      void load();
    } catch (error) {
      reportApiError(error, "errors.archiveFailed");
    } finally {
      setArchiveTarget(null);
    }
  };

  const orderColumns = useMemo(
    () =>
      buildOrderColumns({
        usersById,
        onView: (row) => router.push(`/sales/orders/${row.id}`),
        onDuplicate: handleDuplicate,
        onPrint: handlePrintRow,
        onCancel: setCancelTarget,
        onArchive: setArchiveTarget,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, usersById, activeCompany, user],
  );

  const selectedIds = Object.keys(rowSelection);
  // Only rows actually fetched (this session) have data in the cache — a
  // huge "select all matching" set can include IDs never paged through.
  // Print/Export need real row data, so they operate on the subset that's
  // actually available; Archive is ID-only and works on the full selection
  // regardless (the backend enforces the archivable-status rule per row).
  const selectedItems = selectedIds.map((id) => itemsCache[id]).filter((item) => !!item);
  const selectedArchivable = selectedItems.filter((item) =>
    ORDER_ARCHIVABLE_STATUSES.includes(item.status),
  );
  const hasUncachedSelection = selectedIds.length > selectedItems.length;

  const handleBulkPrint = () => {
    if (selectedItems.length === 0) return;
    printList({
      variant: "list",
      title: t("sales.orders.title"),
      company: {
        name: printCompany.name,
        logoUrl: printCompany.logoUrl ?? null,
      },
      printedByName: user?.fullName ?? null,
      columns: exportColumnsFromKeys(orderColumns, orderExportColumns, t),
      rows: selectedItems.map(toPrintRow),
    });
  };

  const handleBulkExport = () => {
    if (selectedItems.length === 0) return;
    exportRowsToCsv(
      selectedItems.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
      orderExportColumns,
      "sales-orders-selected.csv",
    );
  };

  // Shared select-all rules (tables-selection.md): stale results dropped,
  // "All N matching" only for a complete result of the current query.
  const handleSelectAllMatching = () =>
    matching.selectAllMatching(
      () =>
        salesOrdersService.listIds({
          search: search || undefined,
          status: statusFilter as SalesDocumentStatusValue[],
          partnerId: customerFilter.map((customer) => customer.id),
          dateFrom: dateRange.from ? toISODate(dateRange.from) : undefined,
          dateTo: dateRange.to ? toISODate(dateRange.to) : undefined,
        }),
      setRowSelection,
    );

  const handleBulkArchiveConfirmed = async () => {
    setBulkArchiveOpen(false);
    // Send every selected ID, not just the cache-known archivable subset —
    // a "select all matching" selection can include rows never fetched, and
    // `archive()` already enforces the status rule per row server-side.
    const result = await salesOrdersService.bulkArchive(selectedIds);
    if (result.failed.length === 0) {
      toast.success(t("sales.orders.toasts.bulkArchived", { count: result.succeeded.length }));
    } else {
      toast.error(t("sales.orders.toasts.bulkArchiveFailed", { count: result.failed.length }));
    }
    setRowSelection({});
    void load();
  };

  return (
    <PageWorkspace
      dense
      title={t("sales.orders.title")}
      description={t("sales.orders.description")}
      actions={
        <>
          <ModuleImportButtons importType="SALES_ORDERS" onImported={load} />
          {canCreate && (
            <EnterpriseButton type="button" onClick={() => router.push("/sales/orders/new")}>
              <Plus />
              {t("sales.orders.addNew")}
            </EnterpriseButton>
          )}
        </>
      }
    >
      <EnterpriseDataTable
        filterBar={
          <>
            <MultiSelectFilter
              label={t("sales.orders.filters.status")}
              values={statusFilter}
              onChange={(values) => {
                setStatusFilter(values);
                setPage(1);
              }}
              options={ORDER_FILTERABLE_STATUSES.map((status) => ({
                value: status,
                label: t(ORDER_STATUS_LABEL_KEY[status]),
              }))}
            />
            <MultiEntityFilter
              label={t("sales.orders.fields.customer")}
              values={customerFilter}
              onChange={(customers) => {
                setCustomerFilter(customers);
                setPage(1);
              }}
              onSearch={async (search) => {
                const result = await partnersService.catalog({
                  search: search || undefined,
                  pageSize: 20,
                });
                return result.items;
              }}
              getId={(customer) => customer.id}
              getTitle={(customer) => customer.name}
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
                (customerFilter.length > 0 ? 1 : 0) +
                (dateRange.from || dateRange.to ? 1 : 0)
              }
              onClear={() => {
                setStatusFilter([]);
                setCustomerFilter([]);
                setDateRange(EMPTY_DATE_RANGE);
                setPage(1);
              }}
            />
          </>
        }

        tableId="sales-orders"
        printTitle={t("sales.orders.title")}
        columns={orderColumns}
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
        selectionResetKey={matching.queryKey}
        matchingSelection={matching.matchingSelection}
        onSelectAllMatching={handleSelectAllMatching}
        isSelectingAllMatching={matching.isSelectingAllMatching}
        bulkActions={
          <SalesListBulkActions
            onPrint={handleBulkPrint}
            onExport={handleBulkExport}
            onArchive={() => setBulkArchiveOpen(true)}
            // Fully known from cache -> disable when nothing archivable;
            // partially unknown (a "select all matching" set reaching past
            // fetched pages) -> never block the attempt, the backend sorts
            // out which of the selected rows are actually archivable.
            archiveDisabled={!hasUncachedSelection && selectedArchivable.length === 0}
            labels={{
              print: t("table.print"),
              export: t("table.export"),
              archive: t("common.archive"),
            }}
          />
        }
        onRefresh={load}
        exportColumns={exportColumnsFromKeys(orderColumns, orderExportColumns, t)}
        onExport={(selectedKeys, labels) =>
          exportRowsToCsv(
            items.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
            selectedKeys,
            "sales-orders.csv",
            labels,
          )
        }
        emptyTitle={t("sales.orders.empty")}
        renderExpandedRegions={(row) =>
          buildDocumentDetailRegions({
            documentColumnId: "orderNumber",
            partyColumnId: "customer",
            notesColumnId: "createdAt",
            items: toDocumentLineItems(row.items ?? []),
            currency: row.currency,
            party: row.partner,
            notes: row.internalNotes,
            labels: documentDetailLabels(t, "customer"),
            onShowMore: () => router.push(`/sales/orders/${row.id}`),
          })
        }
        getRowId={(row) => row.id}
        getRowHref={(row) => `/sales/orders/${row.id}`}
      />

      <ConfirmationDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        tone="destructive"
        title={t("sales.orders.confirmCancelTitle")}
        description={t("sales.orders.confirmCancelDescription")}
        confirmLabel={t("sales.orders.actions.cancel")}
        cancelLabel={t("common.close")}
        onConfirm={handleCancelConfirmed}
      />

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        tone="destructive"
        title={t("sales.orders.confirmArchiveTitle")}
        description={t("sales.orders.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleArchiveConfirmed}
      />

      <ConfirmationDialog
        open={bulkArchiveOpen}
        onOpenChange={setBulkArchiveOpen}
        tone="destructive"
        title={t("sales.orders.bulk.archiveConfirmTitle", {
          count: hasUncachedSelection ? selectedIds.length : selectedArchivable.length,
        })}
        description={t("sales.orders.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleBulkArchiveConfirmed}
      />
    </PageWorkspace>
  );
}

export default function SalesOrdersPage() {
  return (
    <PermissionGate permission="sales.orders.view">
      <SalesOrdersPageContent />
    </PermissionGate>
  );
}
