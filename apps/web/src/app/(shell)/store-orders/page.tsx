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

  const [items, setItems] = useState<StoreOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [search, setSearch] = usePathRestorableState("search", "");
  const [sortBy, setSortBy] = usePathRestorableState("sortBy", "orderDate");
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
      const result = await storeOrdersService.listIds(listParams());
      setRowSelection(Object.fromEntries(result.ids.map((id) => [id, true])));
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Failed to select all matching orders.",
      );
    } finally {
      setIsSelectingAllMatching(false);
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
        bulkActions={
          <StoreOrdersBulkActions
            onPrint={handleBulkPrint}
            onExport={handleBulkExport}
            labels={{ print: t("table.print"), export: t("table.export") }}
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
