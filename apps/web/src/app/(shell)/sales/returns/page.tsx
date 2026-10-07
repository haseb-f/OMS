"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RowSelectionState } from "@tanstack/react-table";
import { PageWorkspace } from "@/components/shared/page-workspace";
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
  useSelectedRecords,
} from "@/components/shared/data-table";
import { ClearFiltersButton } from "@/components/shared/data-table/clear-filters-button";
import {
  salesReturnsService,
  type SalesDocumentStatusValue,
  type SalesReturnRow,
} from "@/services/sales-returns-service";
import { partnersService, type PartnerPickerRow } from "@/services/partners-service";
import { useUsersLookup } from "@/hooks/use-reference-data";
import {
  buildReturnColumns,
  ReturnActionsCell,
  returnExportColumns,
  type ReturnRowHandlers,
} from "@/config/sales/return-columns";
import { ReturnGridCard } from "@/config/sales/sales-grid-cards";
import {
  RETURN_ARCHIVABLE_STATUSES,
  RETURN_FILTERABLE_STATUSES,
  RETURN_STATUS_LABEL_KEY,
  RETURN_STATUS_TONE,
} from "@/config/sales/return-status";
import { buildReturnPrintPayload } from "@/config/sales/return-print";
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

function SalesReturnsPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { user } = useUserContext();
  const { activeCompany } = useCompany();
  const printCompany = usePrintCompany();
  const { runPrint } = usePrintEngine();

  const [items, setItems] = useState<SalesReturnRow[]>([]);
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
  const usersById = useUsersLookup();
  const [cancelTarget, setCancelTarget] = useState<SalesReturnRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<SalesReturnRow | null>(null);
  const [bulkArchive, setBulkArchive] = useState<{
    targets: SalesReturnRow[];
    skipped: number;
  } | null>(null);

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

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await salesReturnsService.list({ ...listFilters, page, pageSize });
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
        salesReturnsService.list({ ...listFilters, page: nextPage, pageSize: nextPageSize }),
      ),
    [listFilters],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const toPrintRow = useCallback(
    (item: SalesReturnRow): Record<string, string> => ({
      returnNumber: item.returnNumber,
      partner: item.partner?.name ?? "",
      referenceNumber: item.referenceNumber ?? "",
      grandTotal: item.grandTotal,
      status: t(RETURN_STATUS_LABEL_KEY[item.status]),
      createdAt: formatDate(item.createdAt),
      createdBy: item.createdBy ? (usersById[item.createdBy] ?? "") : "",
    }),
    [t, usersById],
  );

  const handleDuplicate = async (row: SalesReturnRow) => {
    if (!row.salesInvoiceId) {
      toast.error(t("sales.returns.toasts.duplicateMissingInvoice"));
      return;
    }
    try {
      const created = await salesReturnsService.create({
        partnerId: row.partnerId,
        salesInvoiceId: row.salesInvoiceId,
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
          salesInvoiceItemId: item.salesInvoiceItemId ?? undefined,
          notes: item.notes ?? undefined,
        })),
      });
      toast.success(t("sales.returns.toasts.duplicated"));
      router.push(`/sales/returns/${created.id}`);
    } catch (error) {
      reportApiError(error, "errors.duplicateFailed");
    }
  };

  // The preview tab opens inside the click; runPrint closes it and shows
  // the reason if the record cannot be loaded.
  const handlePrintRow = (row: SalesReturnRow) =>
    void runPrint(
      "document",
      async () => {
        const full = await salesReturnsService.get(row.id);
        return buildReturnPrintPayload(full, {
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
      await salesReturnsService.cancel(cancelTarget.id);
      reportDestructiveDone(t("sales.returns.toasts.cancelled"));
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
      await salesReturnsService.archive(archiveTarget.id);
      toast.success(t("sales.returns.toasts.archived"));
      void load();
    } catch (error) {
      reportApiError(error, "errors.archiveFailed");
    } finally {
      setArchiveTarget(null);
    }
  };

  const rowHandlers = useMemo<ReturnRowHandlers>(
    () => ({
      usersById,
      onView: (row) => router.push(`/sales/returns/${row.id}`),
      onDuplicate: handleDuplicate,
      onPrint: handlePrintRow,
      onCancel: setCancelTarget,
      onArchive: setArchiveTarget,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, usersById, activeCompany, user],
  );
  const returnColumns = useMemo(() => buildReturnColumns(rowHandlers), [rowHandlers]);

  const { selectedIds, selectedRecords, resolve } = useSelectedRecords({
    items,
    rowSelection,
    fetchAllRows,
    query: listFilters,
  });
  const isArchivable = (item: SalesReturnRow) => RETURN_ARCHIVABLE_STATUSES.includes(item.status);
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
        await salesReturnsService.archive(item.id);
      } catch {
        failures += 1;
      }
    }
    if (failures === 0) {
      toast.success(t("sales.returns.toasts.bulkArchived", { count: targets.length }));
    } else {
      toast.error(t("sales.returns.toasts.bulkArchiveFailed", { count: failures }));
    }
    setRowSelection({});
    void load();
  };

  return (
    <PageWorkspace
      dense
      title={t("sales.returns.title")}
      description={t("sales.returns.description")}
      actions={<ModuleImportButtons importType="SALES_RETURNS" onImported={load} />}
    >
      <EnterpriseDataTable
        filterBar={
          <>
            <MultiSelectFilter
              label={t("sales.returns.filters.status")}
              values={statusFilter}
              onChange={(values) => {
                setStatusFilter(values);
                setPage(1);
              }}
              options={RETURN_FILTERABLE_STATUSES.map((status) => ({
                value: status,
                label: t(RETURN_STATUS_LABEL_KEY[status]),
                tone: RETURN_STATUS_TONE[status],
              }))}
            />
            <MultiEntityFilter
              label={t("sales.returns.fields.customer")}
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

        tableId="sales-returns"
        printTitle={t("sales.returns.title")}
        columns={returnColumns}
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
        exportColumns={exportColumnsFromKeys(returnColumns, returnExportColumns, t)}
        onExport={(selectedKeys, labels) =>
          exportRowsToCsv(
            items.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
            selectedKeys,
            "sales-returns.csv",
            labels,
          )
        }
        emptyTitle={t("sales.returns.empty")}
        renderExpandedRegions={(row) =>
          buildDocumentDetailRegions({
            documentColumnId: "returnNumber",
            partyColumnId: "customer",
            notesColumnId: "createdAt",
            items: toDocumentLineItems(row.items ?? []),
            currency: row.currency,
            party: row.partner,
            notes: row.internalNotes,
            labels: documentDetailLabels(t, "customer"),
            onShowMore: () => router.push(`/sales/returns/${row.id}`),
          })
        }
        renderGridCard={({ row, selected, onToggleSelected }) => (
          <ReturnGridCard
            row={row}
            selected={selected}
            onToggleSelected={onToggleSelected}
            href={`/sales/returns/${row.id}`}
            actionsNode={<ReturnActionsCell row={row} handlers={rowHandlers} />}
          />
        )}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/sales/returns/${row.id}`}
      />

      <ConfirmationDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        tone="destructive"
        title={t("sales.returns.confirmCancelTitle")}
        description={t("sales.returns.confirmCancelDescription")}
        confirmLabel={t("sales.returns.actions.cancel")}
        cancelLabel={t("common.close")}
        onConfirm={handleCancelConfirmed}
      />

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        tone="destructive"
        title={t("sales.returns.confirmArchiveTitle")}
        description={t("sales.returns.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleArchiveConfirmed}
      />

      <ConfirmationDialog
        open={!!bulkArchive}
        onOpenChange={(open) => !open && setBulkArchive(null)}
        tone="destructive"
        title={t("sales.returns.bulk.archiveConfirmTitle", {
          count: bulkArchive?.targets.length ?? 0,
        })}
        description={
          bulkArchive?.skipped
            ? `${t("sales.returns.confirmArchiveDescription")} ${t("table.bulkIneligibleSkipped", { count: bulkArchive.skipped })}`
            : t("sales.returns.confirmArchiveDescription")
        }
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleBulkArchiveConfirmed}
      />
    </PageWorkspace>
  );
}

export default function SalesReturnsPage() {
  return (
    <PermissionGate permission="sales.returns.view">
      <SalesReturnsPageContent />
    </PermissionGate>
  );
}
