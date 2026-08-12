"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RowSelectionState } from "@tanstack/react-table";
import { Plus, X } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EnterpriseButton } from "@/components/ui/button";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { CustomerPicker } from "@/components/business/customer-picker";
import { SalesListBulkActions } from "@/components/sales";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import {
  salesOrdersService,
  type SalesDocumentStatusValue,
  type SalesOrderRow,
} from "@/services/sales-orders-service";
import type { CustomerRow } from "@/services/customers-service";
import { useUsersLookup } from "@/hooks/use-reference-data";
import { buildOrderColumns, orderExportColumns } from "@/config/sales/order-columns";
import {
  ORDER_ARCHIVABLE_STATUSES,
  ORDER_FILTERABLE_STATUSES,
  ORDER_STATUS_LABEL_KEY,
} from "@/config/sales/order-status";
import { buildOrderPrintPayload } from "@/config/sales/order-print";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { formatDate, toISODate } from "@/lib/date";
import { siteConfig } from "@/config/site";
import { ApiError } from "@/services/api-client";
import { PermissionGate } from "@/components/shared/permission-gate";

const EMPTY_DATE_RANGE: DateRangeValue = { from: null, to: null };

function SalesOrdersPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission, user } = useUserContext();
  const { activeCompany } = useCompany();
  const { printList, printDocument } = usePrintEngine();

  const [items, setItems] = useState<SalesOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [customerFilter, setCustomerFilter] = useState<CustomerRow | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE);
  const [isLoading, setIsLoading] = useState(true);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [isSelectingAllMatching, setIsSelectingAllMatching] = useState(false);
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

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await salesOrdersService.list({
        search: search || undefined,
        status: (statusFilter || undefined) as SalesDocumentStatusValue | undefined,
        customerId: customerFilter?.id,
        dateFrom: dateRange.from ? toISODate(dateRange.from) : undefined,
        dateTo: dateRange.to ? toISODate(dateRange.to) : undefined,
        page,
        pageSize,
        sortBy,
        sortOrder,
      });
      setItems(result.items);
      setTotal(result.total);
      setItemsCache((cache) => ({
        ...cache,
        ...Object.fromEntries(result.items.map((item) => [item.id, item])),
      }));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to load sales orders.");
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, customerFilter, dateRange, page, pageSize, sortBy, sortOrder]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const canCreate = hasPermission("sales.orders.create");

  const toPrintRow = useCallback(
    (item: SalesOrderRow): Record<string, string> => ({
      orderNumber: item.orderNumber,
      customer: item.customer?.name ?? "",
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
        customerId: row.customerId,
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
      toast.error(error instanceof ApiError ? error.message : "Failed to duplicate sales order.");
    }
  };

  const handlePrintRow = async (row: SalesOrderRow) => {
    try {
      const full = await salesOrdersService.get(row.id);
      printDocument(
        buildOrderPrintPayload(full, {
          companyName: activeCompany?.name ?? siteConfig.fullName,
          companyLogoUrl: activeCompany?.logoUrl ?? null,
          printedByName: user?.fullName ?? null,
          t,
        }),
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to print sales order.");
    }
  };

  const handleCancelConfirmed = async () => {
    if (!cancelTarget) return;
    try {
      await salesOrdersService.cancel(cancelTarget.id);
      toast.success(t("sales.orders.toasts.cancelled"));
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to cancel sales order.");
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
      toast.error(error instanceof ApiError ? error.message : "Failed to archive sales order.");
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
        name: activeCompany?.name ?? siteConfig.fullName,
        logoUrl: activeCompany?.logoUrl ?? null,
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

  const handleSelectAllMatching = async () => {
    setIsSelectingAllMatching(true);
    try {
      const result = await salesOrdersService.listIds({
        search: search || undefined,
        status: (statusFilter || undefined) as SalesDocumentStatusValue | undefined,
        customerId: customerFilter?.id,
        dateFrom: dateRange.from ? toISODate(dateRange.from) : undefined,
        dateTo: dateRange.to ? toISODate(dateRange.to) : undefined,
      });
      setRowSelection(Object.fromEntries(result.ids.map((id) => [id, true])));
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Failed to select all matching orders.",
      );
    } finally {
      setIsSelectingAllMatching(false);
    }
  };

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
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("sales.orders.title")}
        subtitle={t("sales.orders.description")}
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
        filters={
          <>
            <Select
              value={statusFilter || "__all__"}
              onValueChange={(v) => {
                setStatusFilter(v === "__all__" ? "" : v);
                setPage(1);
              }}
            >
              <SelectTrigger size="sm" className="w-40">
                <SelectValue placeholder={t("sales.orders.filters.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("sales.orders.filters.allStatuses")}</SelectItem>
                {ORDER_FILTERABLE_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(ORDER_STATUS_LABEL_KEY[status])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <CustomerPicker
                value={customerFilter}
                onChange={(customer) => {
                  setCustomerFilter(customer);
                  setPage(1);
                }}
              />
              {customerFilter && (
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("sales.orders.filters.allCustomers")}
                  onClick={() => {
                    setCustomerFilter(null);
                    setPage(1);
                  }}
                >
                  <X className="size-3.5" />
                </EnterpriseButton>
              )}
            </div>
            <EnterpriseDateRangePicker
              value={dateRange}
              onChange={(range) => {
                setDateRange(range);
                setPage(1);
              }}
            />
          </>
        }
      />

      <EnterpriseDataTable
        tableId="sales-orders"
        printTitle={t("sales.orders.title")}
        columns={orderColumns}
        data={items}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
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
        onSelectAllMatching={handleSelectAllMatching}
        isSelectingAllMatching={isSelectingAllMatching}
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
        onExport={(selectedKeys) =>
          exportRowsToCsv(
            items.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
            selectedKeys,
            "sales-orders.csv",
          )
        }
        emptyTitle={t("sales.orders.empty")}
        getRowId={(row) => row.id}
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
    </div>
  );
}

export default function SalesOrdersPage() {
  return (
    <PermissionGate permission="sales.orders.view">
      <SalesOrdersPageContent />
    </PermissionGate>
  );
}
