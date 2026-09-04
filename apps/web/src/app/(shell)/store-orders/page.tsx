"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RowSelectionState } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { SyncButton } from "@/components/shared/sync-button";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { MultiSelectFilter } from "@/components/shared/data-table";
import {
  EnterpriseDataTable,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { StoreOrdersBulkActions } from "@/components/store-orders/store-orders-bulk-actions";
import { BulkShippingStatusDialog } from "@/components/store-orders/bulk-shipping-status-dialog";
import { StoreOrderCreateDialog } from "@/components/store-orders/store-order-create-dialog";
import { buildStoreOrderDetailRegions } from "@/components/store-orders/store-order-expanded-detail";
import { StoreOrderMobileCard } from "@/components/store-orders/store-order-mobile-card";
import {
  storeOrdersService,
  type StoreOrderPaymentStatusValue,
  type StoreOrderRow,
  type StoreOrderShippingStageValue,
  type StoreOrderSourceValue,
} from "@/services/store-orders-service";
import { shippingService } from "@/services/shipping-service";
import {
  buildStoreOrderColumns,
  storeOrderExportColumnList,
  storeOrderExportColumns,
  storeOrderPrintRow,
} from "@/config/store-orders/order-columns";
import {
  PAYMENT_STATUS_LABEL_KEY,
  PAYMENT_STATUS_VALUES,
  SHIPPING_STAGE_LABEL_KEY,
  SHIPPING_STAGE_VALUES,
} from "@/config/store-orders/status";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { toISODate } from "@/lib/date";
import { siteConfig } from "@/config/site";
import { ApiError } from "@/services/api-client";
import { PermissionGate } from "@/components/shared/permission-gate";

const EMPTY_DATE_RANGE: DateRangeValue = { from: null, to: null };

function StoreOrdersPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { user, hasPermission } = useUserContext();
  const { activeCompany } = useCompany();
  const { printList } = usePrintEngine();
  const canCreate = hasPermission("store-orders.create");
  const canBulkShipping = hasPermission("shipping.manage");

  const [items, setItems] = useState<StoreOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [search, setSearch] = usePathRestorableState("search", "");
  const [sortBy, setSortBy] = usePathRestorableState("sortBy", "createdAt");
  const [sortOrder, setSortOrder] = usePathRestorableState<"asc" | "desc">("sortOrder", "desc");
  const [paymentStatusFilter, setPaymentStatusFilter] = usePathRestorableState<string[]>(
    "paymentStatus",
    [],
  );
  const [shippingStageFilter, setShippingStageFilter] = usePathRestorableState<string[]>(
    "shippingStage",
    [],
  );
  const [sourceFilter, setSourceFilter] = usePathRestorableState<string[]>("source", []);
  const [dateRange, setDateRange] = usePathRestorableState<DateRangeValue>(
    "dateRange",
    EMPTY_DATE_RANGE,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [isSelectingAllMatching, setIsSelectingAllMatching] = useState(false);
  const [isSelectingCustomCount, setIsSelectingCustomCount] = useState(false);
  // Advanced Bulk Selection (TASK-064) — set only by "select all filtered"
  // and "select a specific number" (the two "virtual"/query-derived
  // selections), never by individual checkbox clicks or "select current
  // page". When the underlying query changes after one of those runs, the
  // effect below drops the now-stale selection instead of silently keeping
  // orders selected that no longer match anything the user can see.
  const [bulkSelectionQuery, setBulkSelectionQuery] = useState<string | null>(null);
  const [bulkShippingDialogOpen, setBulkShippingDialogOpen] = useState(false);
  const [isBulkUpdatingShipping, setIsBulkUpdatingShipping] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDialogSession, setCreateDialogSession] = useState(0);
  const [archiveTarget, setArchiveTarget] = useState<StoreOrderRow | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  // Cross-page selection cache (mirrors sales/orders/page.tsx) — `items`
  // only ever holds the current page, so a row selected earlier keeps its
  // real data available for bulk print/export after paging away.
  const [itemsCache, setItemsCache] = useState<Record<string, StoreOrderRow>>({});

  const listParams = useCallback(
    () => ({
      search: search || undefined,
      paymentStatus: paymentStatusFilter as StoreOrderPaymentStatusValue[],
      shippingStage: shippingStageFilter as StoreOrderShippingStageValue[],
      source: sourceFilter as StoreOrderSourceValue[],
      dateFrom: dateRange.from ? toISODate(dateRange.from) : undefined,
      dateTo: dateRange.to ? toISODate(dateRange.to) : undefined,
    }),
    [search, paymentStatusFilter, shippingStageFilter, sourceFilter, dateRange],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await storeOrdersService.list({
        ...listParams(),
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
      setLoadError(error instanceof ApiError ? error.message : t("table.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [listParams, page, pageSize, sortBy, sortOrder, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /** Identifies "the query a virtual bulk selection was built from" — same filters+sort `listIds` was called with. */
  const querySignature = useCallback(
    () => JSON.stringify({ ...listParams(), sortBy, sortOrder }),
    [listParams, sortBy, sortOrder],
  );

  // Selection Snapshot Safety (TASK-064) — a "select all filtered"/"select
  // first N" selection means "the set matching THIS query", not "whatever
  // these ids resolve to later". If the filters or sort change afterward,
  // drop the now-stale selection and say so, rather than leaving orders
  // selected that the user can no longer see or that the count no longer
  // describes. Selections built by hand (checkbox clicks, "select current
  // page") never set `bulkSelectionQuery`, so they're untouched here and
  // survive filter/sort changes, same as pagination.
  useEffect(() => {
    if (Object.keys(rowSelection).length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (bulkSelectionQuery !== null) setBulkSelectionQuery(null);
      return;
    }
    if (bulkSelectionQuery === null) return;
    const currentSignature = querySignature();
    if (currentSignature !== bulkSelectionQuery) {
      setRowSelection({});
      setBulkSelectionQuery(null);
      toast.info(t("storeOrders.bulkSelection.selectionCleared"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [querySignature, rowSelection]);

  const toPrintRow = useCallback(
    (item: StoreOrderRow): Record<string, string> => storeOrderPrintRow(item, t),
    [t],
  );

  const columns = useMemo(
    () =>
      buildStoreOrderColumns({
        onView: (row) => router.push(`/store-orders/${row.id}`),
        onEdit: (row) => router.push(`/store-orders/${row.id}`),
        onArchive: (row) => setArchiveTarget(row),
      }),
    [router],
  );

  const selectedIds = Object.keys(rowSelection);
  const selectedItems = selectedIds.map((id) => itemsCache[id]).filter((item) => !!item);

  const handleBulkPrint = () => {
    if (selectedItems.length === 0) return;
    printList({
      variant: "list",
      title: t("storeOrders.title"),
      company: {
        name: activeCompany?.name ?? siteConfig.fullName,
        logoUrl: activeCompany?.logoUrl ?? null,
      },
      printedByName: user?.fullName ?? null,
      columns: storeOrderExportColumnList(t),
      rows: selectedItems.map(toPrintRow),
    });
  };

  const handleBulkExport = () => {
    if (selectedItems.length === 0) return;
    exportRowsToCsv(
      selectedItems.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
      storeOrderExportColumns,
      "store-orders-selected.csv",
    );
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    setIsArchiving(true);
    try {
      await storeOrdersService.archive(archiveTarget.id);
      toast.success(t("common.archive"));
      setArchiveTarget(null);
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
    } finally {
      setIsArchiving(false);
    }
  };

  const handleSelectAllMatching = async () => {
    setIsSelectingAllMatching(true);
    try {
      const result = await storeOrdersService.listIds({ ...listParams(), sortBy, sortOrder });
      setRowSelection(Object.fromEntries(result.ids.map((id) => [id, true])));
      setBulkSelectionQuery(querySignature());
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Failed to select all matching orders.",
      );
    } finally {
      setIsSelectingAllMatching(false);
    }
  };

  /** "Select a specific number" — the first `count` orders by the current filter AND current sort (never an arbitrary subset). Reports when fewer than requested were available. */
  const handleSelectCustomCount = async (count: number) => {
    setIsSelectingCustomCount(true);
    try {
      const result = await storeOrdersService.listIds({
        ...listParams(),
        sortBy,
        sortOrder,
        limit: count,
      });
      setRowSelection(Object.fromEntries(result.ids.map((id) => [id, true])));
      setBulkSelectionQuery(querySignature());
      if (result.ids.length < count) {
        toast.info(t("storeOrders.bulkSelection.customCountPartial", { count: result.ids.length }));
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to select orders.");
    } finally {
      setIsSelectingCustomCount(false);
    }
  };

  /**
   * Bulk "Change Shipping Status" — server enforces `shipping.manage`
   * (same guard `BulkShippingStatusDialog`'s button hides behind); this
   * only reports what actually happened, including partial failures. Named
   * order numbers for a handful of failures give the user something
   * actionable instead of a bare count.
   */
  const handleBulkShippingStatusChange = async (shippingStatusId: string) => {
    setIsBulkUpdatingShipping(true);
    try {
      const results = await shippingService.bulkSetStatus(selectedIds, shippingStatusId);
      const succeeded = results.filter((row) => row.success).length;
      const failed = results.filter((row) => !row.success);
      if (failed.length === 0) {
        toast.success(t("storeOrders.bulkShipping.successMessage", { count: succeeded }));
      } else {
        const MAX_LISTED = 5;
        const labels = failed
          .slice(0, MAX_LISTED)
          .map((row) => itemsCache[row.id]?.internalOrderId ?? row.id);
        const remaining = failed.length - labels.length;
        const failedDetail =
          remaining > 0 ? `${labels.join("، ")} +${remaining}` : labels.join("، ");
        const failureText = `${t("storeOrders.bulkShipping.failureMessage", { count: failed.length })}: ${failedDetail}`;
        if (succeeded === 0) {
          toast.error(failureText);
        } else {
          toast.success(t("storeOrders.bulkShipping.successMessage", { count: succeeded }), {
            description: failureText,
          });
        }
      }
      setRowSelection({});
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to update shipping status.");
    } finally {
      setIsBulkUpdatingShipping(false);
    }
  };

  return (
    <PageWorkspace
      title={t("storeOrders.title")}
      description={t("storeOrders.description")}
      actions={
        <>
          {canCreate && (
            <EnterpriseButton
              type="button"
              className="gap-1.5"
              onClick={() => {
                setCreateDialogSession((session) => session + 1);
                setCreateDialogOpen(true);
              }}
            >
              <Plus className="size-4" />
              {t("storeOrders.createDialog.trigger")}
            </EnterpriseButton>
          )}
          <SyncButton sourceType="STORE_ORDERS" onSynced={load} />
        </>
      }
    >
      <EnterpriseDataTable
        tableId="store-orders"
        printTitle={t("storeOrders.title")}
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
        searchPlaceholder={t("storeOrders.searchPlaceholder")}
        isLoading={isLoading}
        error={loadError}
        onRetry={load}
        renderExpandedRegions={(row) =>
          buildStoreOrderDetailRegions(row, t, () => router.push(`/store-orders/${row.id}`))
        }
        renderMobileRow={({ row, selected, onToggleSelected, expanded, onToggleExpanded }) => (
          <StoreOrderMobileCard
            order={row}
            selected={selected}
            onToggleSelected={onToggleSelected}
            expanded={expanded}
            onToggleExpanded={onToggleExpanded}
            onView={(order) => router.push(`/store-orders/${order.id}`)}
            onEdit={(order) => router.push(`/store-orders/${order.id}`)}
            onArchive={(order) => setArchiveTarget(order)}
          />
        )}
        filterBar={
          <>
            <MultiSelectFilter
              label={t("storeOrders.filters.paymentStatus")}
              values={paymentStatusFilter}
              onChange={(values) => {
                setPaymentStatusFilter(values);
                setPage(1);
              }}
              options={PAYMENT_STATUS_VALUES.map((status) => ({
                value: status,
                label: t(PAYMENT_STATUS_LABEL_KEY[status]),
              }))}
            />
            <MultiSelectFilter
              label={t("storeOrders.filters.shippingStage")}
              values={shippingStageFilter}
              onChange={(values) => {
                setShippingStageFilter(values);
                setPage(1);
              }}
              options={SHIPPING_STAGE_VALUES.map((stage) => ({
                value: stage,
                label: t(SHIPPING_STAGE_LABEL_KEY[stage]),
              }))}
            />
            <MultiSelectFilter
              label={t("storeOrders.filters.source")}
              values={sourceFilter}
              onChange={(values) => {
                setSourceFilter(values);
                setPage(1);
              }}
              options={[
                { value: "MANUAL", label: t("storeOrders.source.MANUAL") },
                { value: "IMPORT", label: t("storeOrders.source.IMPORT") },
              ]}
            />
            <EnterpriseDateRangePicker
              value={dateRange}
              onChange={(range) => {
                setDateRange(range);
                setPage(1);
              }}
            />
            {(paymentStatusFilter.length > 0 ||
              shippingStageFilter.length > 0 ||
              sourceFilter.length > 0 ||
              dateRange.from ||
              dateRange.to) && (
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPaymentStatusFilter([]);
                  setShippingStageFilter([]);
                  setSourceFilter([]);
                  setDateRange(EMPTY_DATE_RANGE);
                  setPage(1);
                }}
              >
                {t("table.clearFilters")}
              </EnterpriseButton>
            )}
          </>
        }
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        onSelectAllMatching={handleSelectAllMatching}
        isSelectingAllMatching={isSelectingAllMatching}
        selectCustomCount={{
          onSelect: handleSelectCustomCount,
          isSelecting: isSelectingCustomCount,
          copy: {
            title: t("storeOrders.bulkSelection.customCountTitle"),
            countLabel: t("storeOrders.bulkSelection.customCountLabel"),
            hint: (count) => t("storeOrders.bulkSelection.customCountHint", { count }),
            confirmLabel: t("storeOrders.bulkSelection.customCountConfirm"),
            invalidMessage: t("storeOrders.bulkSelection.customCountInvalid"),
          },
        }}
        bulkActions={
          <StoreOrdersBulkActions
            onPrint={handleBulkPrint}
            onExport={handleBulkExport}
            onChangeShippingStatus={() => setBulkShippingDialogOpen(true)}
            canChangeShippingStatus={canBulkShipping}
            labels={{
              print: t("table.print"),
              export: t("table.export"),
              changeShippingStatus: t("storeOrders.bulkShipping.button"),
            }}
          />
        }
        onRefresh={load}
        exportColumns={storeOrderExportColumnList(t)}
        onExport={(selectedKeys) =>
          exportRowsToCsv(
            items.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
            selectedKeys,
            "store-orders.csv",
          )
        }
        emptyTitle={t("storeOrders.empty")}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/store-orders/${row.id}`}
      />

      <StoreOrderCreateDialog
        key={createDialogSession}
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={() => void load()}
      />

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        tone="destructive"
        title={t("common.confirmArchiveTitle")}
        description={t("common.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.cancel")}
        isConfirming={isArchiving}
        onConfirm={() => void handleArchive()}
      />

      <BulkShippingStatusDialog
        open={bulkShippingDialogOpen}
        onOpenChange={setBulkShippingDialogOpen}
        selectedCount={selectedIds.length}
        isSubmitting={isBulkUpdatingShipping}
        onConfirm={handleBulkShippingStatusChange}
      />
    </PageWorkspace>
  );
}

export default function StoreOrdersPage() {
  return (
    <PermissionGate permission="store-orders.view">
      <StoreOrdersPageContent />
    </PermissionGate>
  );
}
